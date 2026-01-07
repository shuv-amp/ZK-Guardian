import { useState, useEffect, useCallback, useMemo } from 'react';
import { ethers } from 'ethers';
import { config } from '../config/env';
import { consentRevocationService } from '../services/consentRevocation';

/**
 * useBlockchain Hook
 * 
 * React hook for ethers.js blockchain integration.
 * Per Development Guide §1.
 * 
 * Features:
 * - Provider management
 * - Wallet balance tracking
 * - Transaction monitoring
 * - Consent revocation
 * - Event subscriptions
 */

export interface TransactionStatus {
    hash: string;
    status: 'pending' | 'confirmed' | 'failed';
    confirmations: number;
    error?: string;
}

export interface UseBlockchainState {
    // Connection
    isConnected: boolean;
    isConnecting: boolean;
    connectionError: string | null;

    // Wallet
    walletAddress: string | null;
    balance: string;
    isBalanceLow: boolean;

    // Network
    chainId: number | null;
    blockNumber: number | null;

    // Transactions
    pendingTransactions: TransactionStatus[];

    // Actions
    connect: () => Promise<void>;
    refreshBalance: () => Promise<void>;
    revokeConsent: (consentHash: string, reason: string) => Promise<{ success: boolean; txHash?: string; error?: string }>;
    checkConsentRevoked: (consentHash: string) => Promise<boolean>;
}

export function useBlockchain(): UseBlockchainState {
    // Connection state
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [connectionError, setConnectionError] = useState<string | null>(null);

    // Wallet state
    const [walletAddress, setWalletAddress] = useState<string | null>(null);
    const [balance, setBalance] = useState('0');
    const [isBalanceLow, setIsBalanceLow] = useState(false);

    // Network state
    const [chainId, setChainId] = useState<number | null>(null);
    const [blockNumber, setBlockNumber] = useState<number | null>(null);

    // Transaction state
    const [pendingTransactions, setPendingTransactions] = useState<TransactionStatus[]>([]);

    // Provider reference
    const provider = useMemo(() => {
        if (!config.polygonRpcUrl) {
            return null;
        }
        return new ethers.JsonRpcProvider(config.polygonRpcUrl);
    }, []);

    /**
     * Connect to blockchain
     */
    const connect = useCallback(async () => {
        if (isConnecting || isConnected) {
            return;
        }

        setIsConnecting(true);
        setConnectionError(null);

        try {
            // Initialize consent revocation service
            const initialized = await consentRevocationService.initialize();
            if (!initialized) {
                throw new Error('Failed to initialize blockchain service');
            }

            // Get wallet info
            const address = consentRevocationService.getWalletAddress();
            setWalletAddress(address);

            // Get balance
            const bal = await consentRevocationService.getBalance();
            setBalance(bal);
            setIsBalanceLow(parseFloat(bal) < 0.1);

            // Get network info
            if (provider) {
                const network = await provider.getNetwork();
                setChainId(Number(network.chainId));

                const block = await provider.getBlockNumber();
                setBlockNumber(block);
            }

            setIsConnected(true);
            console.log('[useBlockchain] Connected successfully');

        } catch (error: any) {
            console.error('[useBlockchain] Connection failed:', error);
            setConnectionError(error.message || 'Connection failed');
        } finally {
            setIsConnecting(false);
        }
    }, [isConnecting, isConnected, provider]);

    /**
     * Refresh wallet balance
     */
    const refreshBalance = useCallback(async () => {
        try {
            const bal = await consentRevocationService.getBalance();
            setBalance(bal);
            setIsBalanceLow(parseFloat(bal) < 0.1);
        } catch (error) {
            console.error('[useBlockchain] Failed to refresh balance:', error);
        }
    }, []);

    /**
     * Revoke a consent on-chain
     */
    const revokeConsent = useCallback(async (
        consentHash: string,
        reason: string
    ): Promise<{ success: boolean; txHash?: string; error?: string }> => {
        if (!isConnected) {
            return { success: false, error: 'Not connected' };
        }

        // Add to pending
        const tempHash = `pending-${Date.now()}`;
        setPendingTransactions(prev => [...prev, {
            hash: tempHash,
            status: 'pending',
            confirmations: 0
        }]);

        try {
            const result = await consentRevocationService.revokeConsent(consentHash, reason);

            if (result.success && result.txHash) {
                // Update pending transaction
                setPendingTransactions(prev =>
                    prev.map(tx =>
                        tx.hash === tempHash
                            ? { ...tx, hash: result.txHash!, status: 'confirmed', confirmations: 1 }
                            : tx
                    )
                );

                // Refresh balance
                await refreshBalance();

                // Remove from pending after 10 seconds
                setTimeout(() => {
                    setPendingTransactions(prev =>
                        prev.filter(tx => tx.hash !== result.txHash)
                    );
                }, 10000);
            } else {
                // Remove failed transaction
                setPendingTransactions(prev =>
                    prev.filter(tx => tx.hash !== tempHash)
                );
            }

            return result;

        } catch (error: any) {
            // Remove failed transaction
            setPendingTransactions(prev =>
                prev.filter(tx => tx.hash !== tempHash)
            );

            return {
                success: false,
                error: error.message || 'Transaction failed'
            };
        }
    }, [isConnected, refreshBalance]);

    /**
     * Check if a consent is revoked
     */
    const checkConsentRevoked = useCallback(async (
        consentHash: string
    ): Promise<boolean> => {
        try {
            return await consentRevocationService.isConsentRevoked(consentHash);
        } catch (error) {
            console.error('[useBlockchain] Check revoked failed:', error);
            return false;
        }
    }, []);

    // Subscribe to new blocks
    useEffect(() => {
        if (!provider || !isConnected) {
            return;
        }

        const handleBlock = (blockNum: number) => {
            setBlockNumber(blockNum);
        };

        provider.on('block', handleBlock);

        return () => {
            provider.off('block', handleBlock);
        };
    }, [provider, isConnected]);

    // Periodically refresh balance
    useEffect(() => {
        if (!isConnected) {
            return;
        }

        const interval = setInterval(() => {
            refreshBalance();
        }, 30000); // Every 30 seconds

        return () => clearInterval(interval);
    }, [isConnected, refreshBalance]);

    return {
        isConnected,
        isConnecting,
        connectionError,
        walletAddress,
        balance,
        isBalanceLow,
        chainId,
        blockNumber,
        pendingTransactions,
        connect,
        refreshBalance,
        revokeConsent,
        checkConsentRevoked
    };
}

export default useBlockchain;
