const HEX_PREFIXED_RE = /^0x[0-9a-fA-F]+$/;
const DECIMAL_RE = /^[0-9]+$/;
const RAW_HEX_RE = /^[0-9a-fA-F]+$/;

export function normalizeFieldElementInput(value: string): string {
    const trimmed = value.trim();

    if (HEX_PREFIXED_RE.test(trimmed)) {
        return `0x${trimmed.slice(2).toLowerCase()}`;
    }

    if (DECIMAL_RE.test(trimmed)) {
        return trimmed;
    }

    if (RAW_HEX_RE.test(trimmed)) {
        return `0x${trimmed.toLowerCase()}`;
    }

    return trimmed;
}

export function isFieldElementInput(value: string): boolean {
    const normalized = normalizeFieldElementInput(value);
    return DECIMAL_RE.test(normalized) || HEX_PREFIXED_RE.test(normalized);
}

export function parseFieldElementInput(value: string): bigint {
    return BigInt(normalizeFieldElementInput(value));
}

export function formatFieldElementHex(value: string | bigint): string {
    const parsed = typeof value === 'bigint' ? value : parseFieldElementInput(value);
    return `0x${parsed.toString(16)}`;
}
