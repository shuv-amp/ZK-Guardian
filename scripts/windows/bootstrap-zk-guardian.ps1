[CmdletBinding()]
param(
    [ValidateSet("all", "install", "start", "stop")]
    [string]$Mode = "all",
    [string]$RepoUrl = "https://github.com/shuv-amp/zk-guardian.git",
    [string]$InstallDir = "$env:USERPROFILE\ZK-Guardian",
    [ValidateSet("public", "local")]
    [string]$FhirMode = "public",
    [switch]$SkipMobile,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$script:StateDir = Join-Path $env:USERPROFILE ".zkguardian"
$script:StateFile = Join-Path $script:StateDir "bootstrap-state.json"
$script:RunState = @{
    workspace = $null
    processes = @{}
    lastRunUtc = (Get-Date).ToUniversalTime().ToString("o")
}

$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "[WARN] Running without Administrator privileges. Package installs may fail." -ForegroundColor Yellow
}

function Write-Section {
    param([string]$Message)
    Write-Host ""
    Write-Host "============================================================" -ForegroundColor DarkCyan
    Write-Host $Message -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor DarkCyan
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-WarnMsg {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrMsg {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Ensure-StateDir {
    if (-not (Test-Path $script:StateDir)) {
        New-Item -Path $script:StateDir -ItemType Directory -Force | Out-Null
    }
}

function Save-RunState {
    Ensure-StateDir
    $script:RunState.lastRunUtc = (Get-Date).ToUniversalTime().ToString("o")
    $json = $script:RunState | ConvertTo-Json -Depth 6
    Set-Content -Path $script:StateFile -Value $json -Encoding UTF8
}

function Convert-ToHashtable {
    param([Parameter(Mandatory = $true)]$Value)

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [System.Collections.IDictionary]) {
        $table = @{}
        foreach ($key in $Value.Keys) {
            $table[$key.ToString()] = Convert-ToHashtable -Value $Value[$key]
        }
        return $table
    }

    if (($Value -is [System.Collections.IEnumerable]) -and -not ($Value -is [string])) {
        $items = @()
        foreach ($item in $Value) {
            $items += ,(Convert-ToHashtable -Value $item)
        }
        return ,$items
    }

    if ($Value -is [psobject]) {
        $table = @{}
        foreach ($prop in $Value.PSObject.Properties) {
            $table[$prop.Name] = Convert-ToHashtable -Value $prop.Value
        }
        return $table
    }

    return $Value
}

function Load-RunState {
    Ensure-StateDir
    if (Test-Path $script:StateFile) {
        try {
            $loadedRaw = Get-Content $script:StateFile -Raw | ConvertFrom-Json
            if ($loadedRaw) {
                $loaded = Convert-ToHashtable -Value $loadedRaw
                if (-not ($loaded -is [hashtable])) {
                    throw "State file root is not an object."
                }

                if (-not $loaded.ContainsKey("processes") -or -not ($loaded.processes -is [hashtable])) {
                    $loaded.processes = @{}
                }
                if (-not $loaded.ContainsKey("workspace")) {
                    $loaded.workspace = $null
                }
                if (-not $loaded.ContainsKey("lastRunUtc")) {
                    $loaded.lastRunUtc = (Get-Date).ToUniversalTime().ToString("o")
                }
                $script:RunState = $loaded
            }
        } catch {
            Write-WarnMsg "Failed to parse state file. Continuing with fresh runtime state."
        }
    }
}

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")

    # Prefer user PATH entries over machine PATH so portable/user-installed tools
    # can override globally installed versions in the current session.
    $orderedRoots = @($userPath, $machinePath)
    $merged = New-Object System.Collections.Generic.List[string]

    foreach ($root in $orderedRoots) {
        if (-not $root) { continue }
        $parts = $root -split ";"
        foreach ($part in $parts) {
            $entry = $part.Trim()
            if (-not $entry) { continue }

            $exists = $false
            foreach ($current in $merged) {
                if ($current.ToLowerInvariant() -eq $entry.ToLowerInvariant()) {
                    $exists = $true
                    break
                }
            }
            if (-not $exists) {
                $null = $merged.Add($entry)
            }
        }
    }

    $env:Path = ($merged -join ";")
}

function Test-CommandExists {
    param([string]$Name)
    return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-CmdChecked {
    param(
        [Parameter(Mandatory = $true)][string]$Command,
        [string]$WorkingDirectory = (Get-Location).Path,
        [int]$Retries = 1
    )

    $attempt = 0
    while ($attempt -lt $Retries) {
        $attempt++
        Push-Location $WorkingDirectory
        try {
            Write-Host "CMD> $Command" -ForegroundColor DarkGray
            & cmd.exe /d /c $Command
            if ($LASTEXITCODE -ne 0) {
                throw "Command failed with exit code $LASTEXITCODE"
            }
            return
        } catch {
            if ($attempt -ge $Retries) {
                throw
            }
            Write-WarnMsg "Command failed (attempt $attempt/$Retries). Retrying in 4s..."
            Start-Sleep -Seconds 4
        } finally {
            Pop-Location
        }
    }
}

function Ensure-Choco {
    if (Test-CommandExists "choco") {
        return $true
    }

    if (-not $isAdmin) {
        Write-WarnMsg "Chocolatey install skipped (requires Administrator shell)."
        return $false
    }

    Write-Info "Attempting to install Chocolatey..."
    try {
        Set-ExecutionPolicy Bypass -Scope Process -Force
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
        Invoke-Expression ((New-Object System.Net.WebClient).DownloadString("https://community.chocolatey.org/install.ps1"))
        Refresh-Path
        return (Test-CommandExists "choco")
    } catch {
        Write-WarnMsg "Chocolatey install failed: $($_.Exception.Message)"
        return $false
    }
}

function Ensure-Scoop {
    if (Test-CommandExists "scoop") {
        return $true
    }

    Write-Info "Attempting to install Scoop..."
    try {
        Set-ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
        Invoke-Expression (Invoke-RestMethod -Uri "https://get.scoop.sh")
        Refresh-Path
        return (Test-CommandExists "scoop")
    } catch {
        Write-WarnMsg "Scoop install failed: $($_.Exception.Message)"
        return $false
    }
}

function Get-PackageManager {
    if (Test-CommandExists "winget") { return "winget" }
    if (Test-CommandExists "choco") { return "choco" }
    if (Test-CommandExists "scoop") { return "scoop" }

    Write-WarnMsg "No package manager detected (winget/choco/scoop). Attempting auto-bootstrap..."
    if (Ensure-Choco) { return "choco" }
    if (Ensure-Scoop) { return "scoop" }

    return "none"
}

function Ensure-ScoopBucket {
    param([Parameter(Mandatory = $true)][string]$Name)

    if (-not (Test-CommandExists "scoop")) {
        return
    }

    $buckets = (& scoop bucket list | Out-String)
    if ($buckets -match "(?m)^\s*$Name\s") {
        return
    }

    Write-Info "Adding Scoop bucket: $Name"
    Invoke-CmdChecked -Command "scoop bucket add $Name"
}

function Ensure-PackageInstalled {
    param(
        [Parameter(Mandatory = $true)][string]$Manager,
        [Parameter(Mandatory = $true)][string]$Package,
        [Parameter(Mandatory = $true)][string]$DisplayName,
        [switch]$Exact,
        [switch]$ScoopExtras
    )

    switch ($Manager) {
        "winget" {
            $installed = $false
            try {
                $listOutput = & winget list --id $Package --exact --accept-source-agreements 2>$null | Out-String
                if ($listOutput -match [Regex]::Escape($Package)) {
                    $installed = $true
                }
            } catch {
                $installed = $false
            }

            if ($installed) {
                Write-Info "$DisplayName already installed."
                return
            }

            $exactArg = ""
            if ($Exact.IsPresent) {
                $exactArg = "--exact"
            }
            Write-Info "Installing $DisplayName with winget..."
            Invoke-CmdChecked -Command "winget install --id $Package $exactArg --accept-package-agreements --accept-source-agreements --silent"
        }

        "choco" {
            $installed = $false
            try {
                $listOutput = & choco list --local-only --exact $Package 2>$null | Out-String
                if ($listOutput -match "(?im)^\Q$Package\E\s") {
                    $installed = $true
                }
            } catch {
                $installed = $false
            }

            if ($installed) {
                Write-Info "$DisplayName already installed."
                return
            }

            Write-Info "Installing $DisplayName with Chocolatey..."
            Invoke-CmdChecked -Command "choco install -y $Package --no-progress"
        }

        "scoop" {
            if ($ScoopExtras) {
                Ensure-ScoopBucket -Name "extras"
            }

            $installed = $false
            try {
                $listOutput = & scoop list 2>$null | Out-String
                if ($listOutput -match "(?im)^\s*\Q$Package\E\s") {
                    $installed = $true
                }
            } catch {
                $installed = $false
            }

            if ($installed) {
                Write-Info "$DisplayName already installed."
                return
            }

            Write-Info "Installing $DisplayName with Scoop..."
            Invoke-CmdChecked -Command "scoop install $Package"
        }

        default {
            throw "Unsupported package manager: $Manager"
        }
    }
}

function Show-ManualInstallHelp {
    param([string[]]$MissingTools)

    Write-ErrMsg "Cannot auto-install required tools because winget/choco/scoop are unavailable."
    Write-Host ""
    Write-Host "Install these tools manually, then rerun bootstrap:" -ForegroundColor Yellow
    foreach ($tool in $MissingTools) {
        Write-Host " - $tool" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Suggested installers:" -ForegroundColor Yellow
    Write-Host " - Git: https://git-scm.com/download/win"
    Write-Host " - Node 20: https://nodejs.org/en/download"
    Write-Host " - Docker Desktop: https://www.docker.com/products/docker-desktop/"
    Write-Host " - Android Studio: https://developer.android.com/studio"
    throw "Manual prerequisite installation required."
}

function Ensure-ToolchainBinary {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$CommandName,
        [Parameter(Mandatory = $true)][string]$Manager,
        [string]$WingetId,
        [string]$ChocoId,
        [string]$ScoopId,
        [switch]$ScoopExtras
    )

    if (Test-CommandExists $CommandName) {
        Write-Info "$Name already available."
        return
    }

    switch ($Manager) {
        "winget" {
            if (-not $WingetId) { throw "No winget package id for $Name" }
            Ensure-PackageInstalled -Manager "winget" -Package $WingetId -DisplayName $Name -Exact
        }
        "choco" {
            if (-not $ChocoId) { throw "No chocolatey package id for $Name" }
            Ensure-PackageInstalled -Manager "choco" -Package $ChocoId -DisplayName $Name
        }
        "scoop" {
            if (-not $ScoopId) { throw "No scoop package id for $Name" }
            Ensure-PackageInstalled -Manager "scoop" -Package $ScoopId -DisplayName $Name -ScoopExtras:$ScoopExtras
        }
        default {
            throw "Unknown package manager: $Manager"
        }
    }

    Refresh-Path
    if (-not (Test-CommandExists $CommandName)) {
        throw "$Name installation reported success, but '$CommandName' is still unavailable. Open a new shell and retry."
    }
}

function Ensure-Pnpm {
    if (Test-CommandExists "pnpm") {
        Write-Info "pnpm already available."
        return
    }

    if (-not (Test-CommandExists "node")) {
        throw "Node.js is required before pnpm installation."
    }

    Write-Info "Installing pnpm via Corepack..."
    Invoke-CmdChecked -Command "corepack enable"
    Invoke-CmdChecked -Command "corepack prepare pnpm@10.13.1 --activate"
    Refresh-Path

    if (-not (Test-CommandExists "pnpm")) {
        Write-Info "Falling back to npm global install for pnpm..."
        Invoke-CmdChecked -Command "npm install -g pnpm@10.13.1"
        Refresh-Path
    }

    if (-not (Test-CommandExists "pnpm")) {
        throw "pnpm installation failed."
    }
}

function Enable-PnpmBuildScripts {
    param([Parameter(Mandatory = $true)][string]$Workspace)

    Write-Info "Configuring pnpm build-script policy for bootstrap compatibility..."
    try {
        Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm config set --location project dangerouslyAllowAllBuilds true"
        $configValue = (& pnpm config get --location project dangerouslyAllowAllBuilds 2>$null | Out-String).Trim().ToLowerInvariant()
        if ($configValue -ne "true") {
            Write-WarnMsg "Could not confirm pnpm dangerouslyAllowAllBuilds=true. Dependency scripts may still be blocked."
        } else {
            Write-Info "pnpm build scripts are enabled for this workspace."
        }
    } catch {
        Write-WarnMsg "Failed to set pnpm build-script policy: $($_.Exception.Message)"
    }
}

function Get-NodeMajorVersion {
    if (-not (Test-CommandExists "node")) {
        return 0
    }

    try {
        $version = (& node -v).Trim()
        if ($version -match "^v?(\d+)") {
            return [int]$Matches[1]
        }
    } catch {
        return 0
    }

    return 0
}

function Add-PathEntry {
    param(
        [Parameter(Mandatory = $true)][string]$PathEntry,
        [switch]$PersistToUser
    )

    if (-not (Test-Path $PathEntry)) {
        return
    }

    $currentParts = @($env:Path -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
    $existsInCurrent = $false
    foreach ($part in $currentParts) {
        if ($part.Trim().ToLowerInvariant() -eq $PathEntry.Trim().ToLowerInvariant()) {
            $existsInCurrent = $true
            break
        }
    }

    if (-not $existsInCurrent) {
        $env:Path = "$PathEntry;$env:Path"
    }

    if ($PersistToUser.IsPresent) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if (-not $userPath) {
            $userPath = ""
        }
        $userParts = @($userPath -split ";" | Where-Object { $_ -and $_.Trim().Length -gt 0 })
        $existsInUser = $false
        foreach ($part in $userParts) {
            if ($part.Trim().ToLowerInvariant() -eq $PathEntry.Trim().ToLowerInvariant()) {
                $existsInUser = $true
                break
            }
        }

        if (-not $existsInUser) {
            if ($userPath.Length -gt 0) {
                [Environment]::SetEnvironmentVariable("Path", "$PathEntry;$userPath", "User")
            } else {
                [Environment]::SetEnvironmentVariable("Path", $PathEntry, "User")
            }
        }
    }
}

function Install-PortableNode20 {
    $nodeVersion = "20.19.5"
    $nodeFolder = "node-v$nodeVersion-win-x64"
    $toolsRoot = Join-Path $script:StateDir "tools"
    $nodeDir = Join-Path $toolsRoot $nodeFolder
    $nodeExe = Join-Path $nodeDir "node.exe"

    if (Test-Path $nodeExe) {
        Write-Info "Using existing portable Node.js ($nodeVersion): $nodeDir"
        Add-PathEntry -PathEntry $nodeDir -PersistToUser
        return $true
    }

    Ensure-StateDir
    if (-not (Test-Path $toolsRoot)) {
        New-Item -Path $toolsRoot -ItemType Directory -Force | Out-Null
    }

    $zipPath = Join-Path $toolsRoot "$nodeFolder.zip"
    $url = "https://nodejs.org/dist/v$nodeVersion/$nodeFolder.zip"

    try {
        Write-Info "Downloading portable Node.js $nodeVersion ..."
        Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing -TimeoutSec 180
    } catch {
        Write-WarnMsg "Portable Node.js download failed: $($_.Exception.Message)"
        return $false
    }

    try {
        Write-Info "Extracting portable Node.js ..."
        Expand-Archive -Path $zipPath -DestinationPath $toolsRoot -Force
    } catch {
        Write-WarnMsg "Portable Node.js extraction failed: $($_.Exception.Message)"
        return $false
    }

    if (-not (Test-Path $nodeExe)) {
        Write-WarnMsg "Portable Node.js install incomplete: node.exe not found in $nodeDir"
        return $false
    }

    Add-PathEntry -PathEntry $nodeDir -PersistToUser
    Write-Info "Portable Node.js installed at $nodeDir"
    return $true
}

function Ensure-Node20 {
    param([string]$PackageManager)

    $major = Get-NodeMajorVersion
    if ($major -ge 20 -and $major -le 22) {
        if ($major -eq 20) {
            Write-Info "Node.js major version is 20."
        } else {
            Write-WarnMsg "Node.js major version is $major. This is acceptable, but Node 20 is preferred for consistency."
        }
        return
    }

    Write-WarnMsg "Current Node.js major version is $major. Attempting to switch/install Node 20."

    if (Test-CommandExists "nvm") {
        try {
            Invoke-CmdChecked -Command "nvm install 20.19.5"
            Invoke-CmdChecked -Command "nvm use 20.19.5"
            Refresh-Path
            $major = Get-NodeMajorVersion
            if ($major -ge 20 -and $major -le 22) {
                Write-Info "Node now set via nvm."
                return
            }
        } catch {
            Write-WarnMsg "nvm path failed: $($_.Exception.Message)"
        }
    }

    try {
        switch ($PackageManager) {
            "winget" {
                Ensure-PackageInstalled -Manager "winget" -Package "OpenJS.NodeJS.20" -DisplayName "Node.js 20" -Exact
            }
            "choco" {
                Ensure-PackageInstalled -Manager "choco" -Package "nvm" -DisplayName "NVM for Windows"
                Refresh-Path
                if (Test-CommandExists "nvm") {
                    Invoke-CmdChecked -Command "nvm install 20.19.5"
                    Invoke-CmdChecked -Command "nvm use 20.19.5"
                } else {
                    Ensure-PackageInstalled -Manager "choco" -Package "nodejs-lts" -DisplayName "Node.js LTS"
                }
            }
            "scoop" {
                Ensure-PackageInstalled -Manager "scoop" -Package "nvm" -DisplayName "NVM for Windows"
                Refresh-Path
                if (Test-CommandExists "nvm") {
                    Invoke-CmdChecked -Command "nvm install 20.19.5"
                    Invoke-CmdChecked -Command "nvm use 20.19.5"
                } else {
                    Ensure-PackageInstalled -Manager "scoop" -Package "nodejs-lts" -DisplayName "Node.js LTS"
                }
            }
            default {
                throw "No package manager available for Node remediation."
            }
        }
        Refresh-Path
    } catch {
        Write-WarnMsg "Node remediation failed: $($_.Exception.Message)"
    }

    $major = Get-NodeMajorVersion
    if (-not ($major -ge 20 -and $major -le 22)) {
        Write-WarnMsg "Standard Node remediation did not produce Node 20/22. Trying portable Node fallback..."
        if (Install-PortableNode20) {
            Refresh-Path
            $major = Get-NodeMajorVersion
        }
    }

    try {
        $whereNode = & where.exe node 2>$null
        if ($whereNode) {
            $preview = @($whereNode | Select-Object -First 3)
            Write-Info "Node resolution order: $($preview -join ' | ')"
        }
    } catch {
        # best-effort diagnostics only
    }

    if (-not ($major -ge 20 -and $major -le 22)) {
        throw "Unsupported Node major version: $major. Install Node 20/22 (Node 20 preferred), reopen PowerShell, and rerun."
    }
}

function Resolve-Workspace {
    $cwd = (Get-Location).Path
    $cwdPkg = Join-Path $cwd "package.json"
    $cwdWorkspace = Join-Path $cwd "pnpm-workspace.yaml"
    if ((Test-Path $cwdPkg) -and (Test-Path $cwdWorkspace)) {
        Write-Info "Using current directory as workspace: $cwd"
        return $cwd
    }

    if (Test-Path (Join-Path $InstallDir "pnpm-workspace.yaml")) {
        Write-Info "Using existing workspace: $InstallDir"
        return $InstallDir
    }

    if (-not (Test-CommandExists "git")) {
        throw "Git is required to clone repository into $InstallDir."
    }

    $parent = Split-Path $InstallDir -Parent
    if (-not (Test-Path $parent)) {
        New-Item -Path $parent -ItemType Directory -Force | Out-Null
    }

    Write-Info "Cloning repository to $InstallDir ..."
    Invoke-CmdChecked -Command "git clone $RepoUrl `"$InstallDir`"" -WorkingDirectory $parent
    return $InstallDir
}

function Set-EnvValue {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [Parameter(Mandatory = $true)][string]$Key,
        [Parameter(Mandatory = $true)][string]$Value
    )

    if (-not (Test-Path $FilePath)) {
        New-Item -Path $FilePath -ItemType File -Force | Out-Null
    }

    $content = Get-Content -Path $FilePath -Raw
    $escapedKey = [Regex]::Escape($Key)
    $line = "$Key=$Value"

    if ($content -match "(?m)^$escapedKey=.*$") {
        $updated = [Regex]::Replace($content, "(?m)^$escapedKey=.*$", $line)
    } else {
        $updated = $content
        if ($updated.Length -gt 0 -and -not $updated.EndsWith("`n")) {
            $updated += "`r`n"
        }
        $updated += "$line`r`n"
    }

    Set-Content -Path $FilePath -Value $updated -Encoding ASCII
}

function Wait-ForPort {
    param(
        [int]$Port,
        [int]$TimeoutSec = 180
    )

    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $async = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
            $ok = $async.AsyncWaitHandle.WaitOne(800)
            if ($ok) {
                $client.EndConnect($async)
                $client.Dispose()
                return $true
            }
            $client.Dispose()
        } catch {
            # ignore while waiting
        }
        Start-Sleep -Milliseconds 700
    }

    return $false
}

function Wait-ForHttpOk {
    param(
        [string]$Url,
        [int]$TimeoutSec = 240
    )

    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt $TimeoutSec) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 8
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
                return $true
            }
        } catch {
            # keep waiting
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Show-LogTail {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$Lines = 80
    )

    if (-not (Test-Path $Path)) {
        Write-WarnMsg "Log file not found: $Path"
        return
    }

    Write-WarnMsg "Last $Lines lines from ${Path}:"
    try {
        $tail = Get-Content -Path $Path -Tail $Lines
        foreach ($line in $tail) {
            Write-Host "  $line" -ForegroundColor DarkYellow
        }
    } catch {
        Write-WarnMsg "Could not read log tail: $($_.Exception.Message)"
    }
}

function Stop-ProcessOnPort {
    param([int]$Port)
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if (-not $conns) { return }
        $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($pid in $pids) {
            if ($pid -and $pid -ne 0) {
                try {
                    Stop-Process -Id $pid -Force -ErrorAction Stop
                    Write-Info "Stopped process $pid bound to port $Port."
                } catch {
                    Write-WarnMsg "Could not stop process $pid on port $Port."
                }
            }
        }
    } catch {
        Write-WarnMsg "Failed checking port ${Port}: $($_.Exception.Message)"
    }
}

function Start-LoggedBackground {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$WorkingDirectory,
        [Parameter(Mandatory = $true)][string]$Command,
        [Parameter(Mandatory = $true)][string]$LogPath
    )

    $logDir = Split-Path $LogPath -Parent
    if (-not (Test-Path $logDir)) {
        New-Item -Path $logDir -ItemType Directory -Force | Out-Null
    }
    if (Test-Path $LogPath) {
        Remove-Item $LogPath -Force
    }

    $cmdLine = "cd /d `"$WorkingDirectory`" && $Command > `"$LogPath`" 2>&1"
    $proc = Start-Process -FilePath "cmd.exe" -ArgumentList @("/d", "/c", $cmdLine) -PassThru -WindowStyle Hidden
    Write-Info "Started $Name (PID $($proc.Id)). Log: $LogPath"

    $script:RunState.processes[$Name] = @{
        pid = $proc.Id
        command = $Command
        cwd = $WorkingDirectory
        log = $LogPath
    }
    return $proc
}

function Start-HardhatNode {
    param(
        [Parameter(Mandatory = $true)][string]$Workspace,
        [Parameter(Mandatory = $true)][string]$LogPath
    )

    Write-Info "Validating Hardhat CLI availability..."
    Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm --filter contracts exec hardhat --version"

    Stop-ProcessOnPort -Port 8545

    for ($attempt = 1; $attempt -le 2; $attempt++) {
        if ($attempt -gt 1) {
            Write-WarnMsg "Retrying Hardhat startup (attempt $attempt/2) after dependency rebuild..."
            try {
                Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm rebuild --recursive"
            } catch {
                Write-WarnMsg "pnpm rebuild failed during retry: $($_.Exception.Message)"
            }
        }

        Start-LoggedBackground -Name "hardhat" -WorkingDirectory $Workspace -Command "pnpm --filter contracts exec hardhat node --hostname 127.0.0.1 --port 8545" -LogPath $LogPath | Out-Null

        if (Wait-ForPort -Port 8545 -TimeoutSec 120) {
            Write-Info "Hardhat chain is up."
            return
        }

        Write-WarnMsg "Hardhat did not start on port 8545 in attempt $attempt."
        Show-LogTail -Path $LogPath -Lines 80

        if ($script:RunState.processes.ContainsKey("hardhat")) {
            $pid = [int]$script:RunState.processes["hardhat"].pid
            if ($pid -gt 0) {
                try {
                    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
                } catch {
                    # ignore cleanup failure
                }
            }
        }
        Stop-ProcessOnPort -Port 8545
    }

    throw "Hardhat local chain did not start on port 8545. See log: $LogPath"
}

function Ensure-DockerRunning {
    if (-not (Test-CommandExists "docker")) {
        throw "Docker CLI not found after installation."
    }

    try {
        & docker info *> $null
        if ($LASTEXITCODE -eq 0) {
            Write-Info "Docker daemon is already running."
            return
        }
    } catch {
        # continue
    }

    $desktopCandidates = @(
        "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe",
        "$env:LOCALAPPDATA\Programs\Docker\Docker\Docker Desktop.exe"
    )
    $desktopExe = $desktopCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if ($desktopExe) {
        Write-Info "Starting Docker Desktop..."
        Start-Process -FilePath $desktopExe | Out-Null
    } else {
        Write-WarnMsg "Docker Desktop executable not found. Trying to continue if service is already available."
    }

    $start = Get-Date
    while (((Get-Date) - $start).TotalSeconds -lt 300) {
        try {
            & docker info *> $null
            if ($LASTEXITCODE -eq 0) {
                Write-Info "Docker daemon is ready."
                return
            }
        } catch {
            # wait
        }
        Start-Sleep -Seconds 3
    }

    throw "Docker daemon did not become ready in time."
}

function Configure-EnvFile {
    param(
        [string]$Workspace,
        [string]$AuditAddress,
        [string]$RevocationAddress,
        [string]$CredentialAddress
    )

    $envFile = Join-Path $Workspace ".env"
    $example = Join-Path $Workspace ".env.example"

    if (-not (Test-Path $envFile)) {
        if (Test-Path $example) {
            Copy-Item -Path $example -Destination $envFile -Force
        } else {
            New-Item -Path $envFile -ItemType File -Force | Out-Null
        }
    }

    Set-EnvValue -FilePath $envFile -Key "PORT" -Value "3000"
    Set-EnvValue -FilePath $envFile -Key "NODE_ENV" -Value "development"
    Set-EnvValue -FilePath $envFile -Key "DATABASE_URL" -Value "postgresql://postgres:postgres@localhost:5432/zkguardian"
    Set-EnvValue -FilePath $envFile -Key "REDIS_URL" -Value "redis://localhost:6379"
    Set-EnvValue -FilePath $envFile -Key "SMART_CLIENT_ID" -Value "zk-guardian-mobile"
    Set-EnvValue -FilePath $envFile -Key "SMART_REDIRECT_URIS" -Value "zkguardian://auth"
    Set-EnvValue -FilePath $envFile -Key "ALLOW_DEV_BYPASS" -Value "false"
    Set-EnvValue -FilePath $envFile -Key "ENABLE_SYNTHETIC_CONSENT" -Value "true"
    Set-EnvValue -FilePath $envFile -Key "POLYGON_AMOY_RPC" -Value "http://127.0.0.1:8545"
    Set-EnvValue -FilePath $envFile -Key "GATEWAY_PRIVATE_KEY" -Value "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
    Set-EnvValue -FilePath $envFile -Key "AUDIT_CONTRACT_ADDRESS" -Value $AuditAddress
    Set-EnvValue -FilePath $envFile -Key "CONSENT_REVOCATION_REGISTRY_ADDRESS" -Value $RevocationAddress
    Set-EnvValue -FilePath $envFile -Key "CREDENTIAL_REGISTRY_ADDRESS" -Value $CredentialAddress

    if ($FhirMode -eq "public") {
        Set-EnvValue -FilePath $envFile -Key "HAPI_FHIR_URL" -Value "http://hapi.fhir.org/baseR4"
    } else {
        Set-EnvValue -FilePath $envFile -Key "HAPI_FHIR_URL" -Value "http://localhost:8080/fhir"
    }

    Write-Info "Environment file configured: $envFile"

    $gatewayEnv = Join-Path $Workspace "gateway\.env"
    Copy-Item -Path $envFile -Destination $gatewayEnv -Force
    Write-Info "Gateway environment file synced: $gatewayEnv"
}

function Get-AndroidSdkRoot {
    $candidates = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        "$env:LOCALAPPDATA\Android\Sdk",
        "$env:USERPROFILE\AppData\Local\Android\Sdk"
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -gt 0) {
        return $candidates[0]
    }
    return $null
}

function Ensure-AndroidPrerequisites {
    Write-Section "Android setup"

    $sdkRoot = Get-AndroidSdkRoot
    if (-not $sdkRoot) {
        Write-WarnMsg "Android SDK not found. Open Android Studio once and install SDK + platform tools, then rerun."
        return $null
    }

    $env:ANDROID_SDK_ROOT = $sdkRoot
    $env:ANDROID_HOME = $sdkRoot
    $env:Path = "$sdkRoot\platform-tools;$sdkRoot\emulator;$env:Path"

    $jbrCandidates = @(
        "$env:ProgramFiles\Android\Android Studio\jbr",
        "$env:LOCALAPPDATA\Programs\Android Studio\jbr"
    ) | Where-Object { Test-Path $_ }
    if ($jbrCandidates.Count -gt 0) {
        $env:JAVA_HOME = $jbrCandidates[0]
        $env:Path = "$($env:JAVA_HOME)\bin;$env:Path"
    }

    $sdkManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
    $avdManager = Join-Path $sdkRoot "cmdline-tools\latest\bin\avdmanager.bat"
    $emulatorExe = Join-Path $sdkRoot "emulator\emulator.exe"
    $adbExe = Join-Path $sdkRoot "platform-tools\adb.exe"

    if (-not (Test-Path $sdkManager) -or -not (Test-Path $avdManager)) {
        Write-WarnMsg "sdkmanager/avdmanager not found. Install Android SDK Command-line Tools in Android Studio SDK Manager."
        return $null
    }
    if (-not (Test-Path $emulatorExe) -or -not (Test-Path $adbExe)) {
        Write-WarnMsg "Android emulator or ADB not found. Install Emulator + Platform Tools in Android Studio."
        return $null
    }

    Write-Info "Accepting Android SDK licenses..."
    $yesStream = [string]::Join("", (1..120 | ForEach-Object { "y`n" }))
    try {
        $yesStream | & $sdkManager --sdk_root=$sdkRoot --licenses *> $null
    } catch {
        Write-WarnMsg "License acceptance command reported warnings. Continuing."
    }

    Write-Info "Installing required Android SDK components..."
    $systemImage = "system-images;android-35;google_apis;arm64-v8a"
    try {
        & $sdkManager --sdk_root=$sdkRoot `
            "platform-tools" `
            "emulator" `
            "platforms;android-35" `
            "build-tools;35.0.0" `
            $systemImage | Out-Null
    } catch {
        Write-WarnMsg "ARM64 image install failed. Trying x86_64 image..."
        $systemImage = "system-images;android-35;google_apis;x86_64"
        & $sdkManager --sdk_root=$sdkRoot `
            "platform-tools" `
            "emulator" `
            "platforms;android-35" `
            "build-tools;35.0.0" `
            $systemImage | Out-Null
    }

    $avdName = "Pixel_9_Pro_API_35"
    $avdList = & $avdManager list avd | Out-String
    if ($avdList -notmatch [Regex]::Escape($avdName)) {
        Write-Info "Creating AVD $avdName ..."
        $created = $false
        $deviceCandidates = @("pixel_9_pro", "pixel_8_pro", "pixel")
        foreach ($device in $deviceCandidates) {
            try {
                $inputStream = "no`n"
                $inputStream | & $avdManager create avd `
                    -n $avdName `
                    -k $systemImage `
                    -d $device `
                    --force *> $null
                $created = $true
                break
            } catch {
                # try next device id
            }
        }
        if (-not $created) {
            Write-WarnMsg "Failed to auto-create Pixel_9_Pro AVD. Create it manually in Android Studio."
        }
    } else {
        Write-Info "AVD $avdName already exists."
    }

    return @{
        sdkRoot = $sdkRoot
        sdkManager = $sdkManager
        avdManager = $avdManager
        emulatorExe = $emulatorExe
        adbExe = $adbExe
        avdName = $avdName
        systemImage = $systemImage
    }
}

function Launch-MobileStack {
    param(
        [string]$Workspace,
        [string]$LogDir
    )

    $android = Ensure-AndroidPrerequisites
    if (-not $android) {
        Write-WarnMsg "Skipping mobile launch because Android prerequisites are incomplete."
        return
    }

    Write-Info "Checking emulator state..."
    $devices = & $android.adbExe devices | Out-String
    if ($devices -notmatch "emulator-\d+\s+device") {
        Write-Info "Starting Android emulator: $($android.avdName)"
        $emuLog = Join-Path $LogDir "emulator.log"
        Start-LoggedBackground -Name "emulator" -WorkingDirectory $Workspace -Command "`"$($android.emulatorExe)`" -avd $($android.avdName) -no-snapshot-save -no-boot-anim -netdelay none -netspeed full" -LogPath $emuLog | Out-Null
        & $android.adbExe wait-for-device | Out-Null

        $ready = $false
        for ($i = 0; $i -lt 60; $i++) {
            Start-Sleep -Seconds 2
            try {
                $boot = (& $android.adbExe shell getprop sys.boot_completed).Trim()
                if ($boot -eq "1") {
                    $ready = $true
                    break
                }
            } catch {
                # wait
            }
        }

        if (-not $ready) {
            Write-WarnMsg "Emulator did not fully report boot completion within timeout."
        } else {
            Write-Info "Emulator is ready."
        }
    } else {
        Write-Info "Android emulator already running."
    }

    Write-Info "Starting mobile app install/build process in a dedicated PowerShell window..."
    $mobileCommand = "Set-Location '$Workspace'; pnpm --filter mobile android"
    Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $mobileCommand) | Out-Null
}

function Stop-ManagedProcesses {
    Load-RunState
    Write-Section "Stopping managed processes"
    if ($script:RunState.processes) {
        foreach ($name in @("gateway", "hardhat", "emulator")) {
            if ($script:RunState.processes.ContainsKey($name)) {
                $pid = [int]$script:RunState.processes[$name].pid
                if ($pid -gt 0) {
                    try {
                        Stop-Process -Id $pid -Force -ErrorAction Stop
                        Write-Info "Stopped $name (PID $pid)."
                    } catch {
                        Write-WarnMsg "Could not stop $name (PID $pid). It may have already exited."
                    }
                }
            }
        }
    }

    Stop-ProcessOnPort -Port 3000
    Stop-ProcessOnPort -Port 8545
    $script:RunState.processes = @{}
    Save-RunState
}

function Install-Toolchain {
    Write-Section "Installing toolchain"

    $pm = Get-PackageManager
    Write-Info "Package manager selected: $pm"

    if ($pm -eq "none") {
        $missing = @()
        if (-not (Test-CommandExists "git")) { $missing += "Git" }
        if (-not (Test-CommandExists "node")) { $missing += "Node.js" }
        if (-not (Test-CommandExists "docker")) { $missing += "Docker Desktop" }
        if ((-not $SkipMobile) -and -not (Test-Path "$env:LOCALAPPDATA\Android\Sdk")) { $missing += "Android Studio" }

        if ($missing.Count -gt 0) {
            Show-ManualInstallHelp -MissingTools $missing
        }

        Write-WarnMsg "No package manager found, but required tools already exist. Continuing."
        Refresh-Path
        Ensure-Node20 -PackageManager "none"
        Ensure-Pnpm
        return
    }

    Ensure-ToolchainBinary -Name "Git" -CommandName "git" -Manager $pm -WingetId "Git.Git" -ChocoId "git" -ScoopId "git"
    Ensure-ToolchainBinary -Name "Node.js" -CommandName "node" -Manager $pm -WingetId "OpenJS.NodeJS.20" -ChocoId "nodejs-lts" -ScoopId "nodejs-lts"
    if ($pm -eq "scoop" -and -not (Test-CommandExists "docker")) {
        Show-ManualInstallHelp -MissingTools @("Docker Desktop")
    } else {
        Ensure-ToolchainBinary -Name "Docker Desktop" -CommandName "docker" -Manager $pm -WingetId "Docker.DockerDesktop" -ChocoId "docker-desktop" -ScoopId "docker" -ScoopExtras
    }

    if (-not $SkipMobile) {
        # Android Studio has no reliable command binary to probe on PATH, so detect via common install roots.
        $androidStudioInstalled =
            (Test-Path "$env:ProgramFiles\Android\Android Studio\bin\studio64.exe") -or
            (Test-Path "$env:LOCALAPPDATA\Programs\Android Studio\bin\studio64.exe")

        if (-not $androidStudioInstalled) {
            switch ($pm) {
                "winget" {
                    Ensure-PackageInstalled -Manager "winget" -Package "Google.AndroidStudio" -DisplayName "Android Studio" -Exact
                }
                "choco" {
                    Ensure-PackageInstalled -Manager "choco" -Package "androidstudio" -DisplayName "Android Studio"
                }
                "scoop" {
                    Ensure-PackageInstalled -Manager "scoop" -Package "android-studio" -DisplayName "Android Studio" -ScoopExtras
                }
            }
        } else {
            Write-Info "Android Studio already installed."
        }
    }

    Refresh-Path
    Ensure-Node20 -PackageManager $pm
    Ensure-Pnpm
}

function Start-CoreStack {
    param([string]$Workspace)

    Write-Section "Starting core services"
    $logsDir = Join-Path $Workspace "logs\windows-bootstrap"
    if (-not (Test-Path $logsDir)) {
        New-Item -Path $logsDir -ItemType Directory -Force | Out-Null
    }

    Ensure-DockerRunning

    if ($FhirMode -eq "local") {
        Write-Info "Starting Docker infrastructure: postgres, redis, hapi-db, hapi-fhir"
        Invoke-CmdChecked -WorkingDirectory $Workspace -Command "docker compose up -d postgres redis hapi-db hapi-fhir"
        if (-not (Wait-ForHttpOk -Url "http://localhost:8080/fhir/metadata" -TimeoutSec 360)) {
            throw "HAPI FHIR did not become healthy in time."
        }
        Write-Info "HAPI FHIR is healthy."
    } else {
        Write-Info "Using public FHIR endpoint (hapi.fhir.org). Skipping local HAPI container startup."
        Invoke-CmdChecked -WorkingDirectory $Workspace -Command "docker compose up -d postgres redis"
    }

    Enable-PnpmBuildScripts -Workspace $Workspace

    Write-Info "Installing JavaScript dependencies..."
    Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm install"

    try {
        Write-Info "Rebuilding workspace dependencies to ensure native/build artifacts are ready..."
        Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm rebuild --recursive"
    } catch {
        Write-WarnMsg "pnpm rebuild reported warnings: $($_.Exception.Message)"
    }

    Stop-ProcessOnPort -Port 8545
    Stop-ProcessOnPort -Port 3000

    $hardhatLog = Join-Path $logsDir "hardhat.log"
    Start-HardhatNode -Workspace $Workspace -LogPath $hardhatLog

    Write-Info "Deploying local smart contracts..."
    Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm --filter contracts exec hardhat run scripts/deploy-local.js --network localhost"

    $deploymentFile = Join-Path $Workspace "contracts\local-deployment.json"
    if (-not (Test-Path $deploymentFile)) {
        throw "Local deployment output file missing: $deploymentFile"
    }
    $deployment = Get-Content $deploymentFile -Raw | ConvertFrom-Json

    Configure-EnvFile -Workspace $Workspace -AuditAddress $deployment.audit -RevocationAddress $deployment.registry -CredentialAddress $deployment.credentialRegistry

    Write-Info "Preparing gateway database..."
    Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm --filter gateway exec prisma generate"
    Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm --filter gateway exec prisma migrate deploy"

    $gatewayLog = Join-Path $logsDir "gateway.log"
    Start-LoggedBackground -Name "gateway" -WorkingDirectory $Workspace -Command "pnpm --filter gateway exec tsx src/index.ts" -LogPath $gatewayLog | Out-Null

    if (-not (Wait-ForHttpOk -Url "http://127.0.0.1:3000/health" -TimeoutSec 120)) {
        throw "Gateway health endpoint did not become ready on http://127.0.0.1:3000/health"
    }
    Write-Info "Gateway is healthy."

    if ($FhirMode -eq "public") {
        Write-Info "Running full flow verification against public FHIR..."
        $oldBase = $env:BASE_URL
        try {
            $env:BASE_URL = "http://127.0.0.1:3000"
            Push-Location $Workspace
            try {
                & pnpm --filter gateway verify:full-flow
                if ($LASTEXITCODE -ne 0) {
                    throw "Gateway full-flow verification failed."
                }
            } finally {
                Pop-Location
            }
        } finally {
            if ($null -eq $oldBase) {
                Remove-Item Env:BASE_URL -ErrorAction SilentlyContinue
            } else {
                $env:BASE_URL = $oldBase
            }
        }
    } else {
        Write-Info "Running gateway test suite for local FHIR mode..."
        Invoke-CmdChecked -WorkingDirectory $Workspace -Command "pnpm --filter gateway test --run"
    }

    if ($FhirMode -eq "public") {
        Write-Info "Public FHIR integration verification complete."
    } else {
        Write-Info "Local FHIR mode verification complete."
    }

    Save-RunState

    if (-not $SkipMobile) {
        Launch-MobileStack -Workspace $Workspace -LogDir $logsDir
    } else {
        Write-Info "Mobile setup skipped by flag."
    }

    if (-not $NoOpen) {
        Write-Info "Opening key URLs..."
        Start-Process "http://localhost:3000/health" | Out-Null
        if ($FhirMode -eq "local") {
            Start-Process "http://localhost:8080/fhir/metadata" | Out-Null
        } else {
            Start-Process "http://hapi.fhir.org/baseR4/metadata" | Out-Null
        }
        Start-Process "explorer.exe" -ArgumentList (Join-Path $Workspace "logs\windows-bootstrap") | Out-Null
    }
}

Write-Section "ZK Guardian Windows Master Bootstrap"
Write-Info "Mode: $Mode"
Write-Info "FHIR mode: $FhirMode"
Write-Info "Skip mobile: $($SkipMobile.IsPresent)"

if ($Mode -eq "stop") {
    Stop-ManagedProcesses
    Write-Section "Done"
    Write-Info "Managed local processes stopped."
    exit 0
}

Load-RunState

if ($Mode -eq "all" -or $Mode -eq "install") {
    Install-Toolchain
}

Refresh-Path
$workspace = Resolve-Workspace
$script:RunState.workspace = $workspace
Save-RunState

if ($Mode -eq "all" -or $Mode -eq "start") {
    Start-CoreStack -Workspace $workspace
}

Write-Section "Bootstrap Complete"
Write-Info "Workspace: $workspace"
Write-Info "Gateway health: http://localhost:3000/health"
if ($FhirMode -eq "public") {
    Write-Info "FHIR source: http://hapi.fhir.org/baseR4"
} else {
    Write-Info "FHIR source: http://localhost:8080/fhir"
}
Write-Info "Run 'scripts\\windows\\bootstrap-zk-guardian.ps1 -Mode stop' to stop managed services."
