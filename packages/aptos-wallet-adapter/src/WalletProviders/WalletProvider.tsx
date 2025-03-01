import { useLocalStorage } from '../hooks/useLocalStorage';
import { FC, ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { TransactionPayload } from 'aptos/src/generated';
import {
  WalletError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletNotSelectedError
} from './errors';
import {
  AccountKeys,
  WalletAdapter,
  WalletName,
  WalletReadyState
} from '../WalletAdapters/BaseAdapter';
import { Wallet, WalletContext } from './useWallet';

export interface WalletProviderProps {
  children: ReactNode;
  wallets: WalletAdapter[];
  autoConnect?: boolean;
  onError?: (error: WalletError) => void;
  localStorageKey?: string;
}

const initialState: {
  wallet: Wallet | null;
  adapter: WalletAdapter | null;
  account: AccountKeys | null;
  connected: boolean;
} = {
  wallet: null,
  adapter: null,
  account: null,
  connected: false
};

export const WalletProvider: FC<WalletProviderProps> = ({
  children,
  wallets: adapters,
  autoConnect = false,
  onError,
  localStorageKey = 'walletName'
}) => {
  const [name, setName] = useLocalStorage<WalletName | null>(localStorageKey, null);
  const [{ wallet, adapter, account, connected }, setState] = useState(initialState);
  const readyState = adapter?.readyState || WalletReadyState.Unsupported;
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const isConnecting = useRef(false);
  const isDisconnecting = useRef(false);
  const isUnloading = useRef(false);

  // Wrap adapters to conform to the `Wallet` interface
  const [wallets, setWallets] = useState(() =>
    adapters.map((adpt) => ({
      adapter: adpt,
      readyState: adpt.readyState
    }))
  );

  // When the wallets change, start to listen for changes to their `readyState`
  useEffect(() => {
    // When the adapters change, wrap them to conform to the `Wallet` interface
    setWallets((currentWallets) =>
      adapters.map((wAdapter, index) => {
        const currentWallet = currentWallets[index];
        // If the wallet hasn't changed, return the same instance
        return currentWallet &&
          currentWallet.adapter === wAdapter &&
          currentWallet.readyState === wAdapter.readyState
          ? currentWallet
          : {
              adapter: wAdapter,
              readyState: wAdapter.readyState
            };
      })
    );

    function handleReadyStateChange(this: any, wReadyState: WalletReadyState) {
      setWallets((prevWallets) => {
        const index = prevWallets.findIndex(({ adapter: wAdapter }) => wAdapter === this);
        if (index === -1) return prevWallets;

        const { adapter: wAdapter } = prevWallets[index]!;
        return [
          ...prevWallets.slice(0, index),
          { adapter: wAdapter, readyState: wReadyState },
          ...prevWallets.slice(index + 1)
        ];
      });
    }

    adapters.forEach((wAdapter) =>
      wAdapter.on('readyStateChange', handleReadyStateChange, wAdapter)
    );
    return () =>
      adapters.forEach((wAdapter) =>
        wAdapter.off('readyStateChange', handleReadyStateChange, wAdapter)
      );
  }, [adapters]);

  // When the selected wallet changes, initialize the state
  useEffect(() => {
    const selectedWallet = wallets.find((wAdapter) => wAdapter.adapter.name === name);
    if (selectedWallet) {
      setState({
        wallet: selectedWallet,
        adapter: selectedWallet.adapter,
        connected: selectedWallet.adapter.connected,
        account: selectedWallet.adapter.publicAccount
      });
    } else {
      setState(initialState);
    }
  }, [name, wallets]);

  // If the window is closing or reloading, ignore disconnect and error events from the adapter
  useEffect(() => {
    function listener() {
      isUnloading.current = true;
    }

    window.addEventListener('beforeunload', listener);
    return () => window.removeEventListener('beforeunload', listener);
  }, [isUnloading]);

  // Handle the adapter's connect event
  const handleConnect = useCallback(() => {
    if (!adapter) return;
    setState((state) => ({
      ...state,
      connected: adapter.connected,
      account: adapter.publicAccount
    }));
  }, [adapter]);

  // Handle the adapter's disconnect event
  const handleDisconnect = useCallback(() => {
    // Clear the selected wallet unless the window is unloading
    if (!isUnloading.current) setName(null);
  }, [isUnloading, setName]);

  // Handle the adapter's error event, and local errors
  const handleError = useCallback(
    (error: WalletError) => {
      // Call onError unless the window is unloading
      if (!isUnloading.current) (onError || console.error)(error);
      return error;
    },
    [isUnloading, onError]
  );

  // Setup and teardown event listeners when the adapter changes
  useEffect(() => {
    if (adapter) {
      adapter.on('connect', handleConnect);
      adapter.on('disconnect', handleDisconnect);
      adapter.on('error', handleError);
      return () => {
        adapter.off('connect', handleConnect);
        adapter.off('disconnect', handleDisconnect);
        adapter.off('error', handleError);
      };
    }
  }, [adapter, handleConnect, handleDisconnect, handleError]);

  // When the adapter changes, disconnect the old one
  useEffect(() => {
    return () => {
      adapter?.disconnect();
    };
  }, [adapter]);

  // If autoConnect is enabled, try to connect when the adapter changes and is ready
  useEffect(() => {
    if (
      isConnecting.current ||
      connected ||
      !autoConnect ||
      !adapter ||
      !(readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable)
    )
      return;

    (async function () {
      isConnecting.current = true;
      setConnecting(true);
      try {
        await adapter.connect();
      } catch (error: any) {
        // Clear the selected wallet
        setName(null);
        // Don't throw error, but handleError will still be called
      } finally {
        setConnecting(false);
        isConnecting.current = false;
      }
    })();
  }, [isConnecting, connected, autoConnect, adapter, readyState, setName]);

  // Connect the adapter to the wallet
  const connect = useCallback(
    async (walletName: WalletName) => {
      if (isConnecting.current || isDisconnecting.current || connected) return;
      if (!name) {
        setName(walletName);
      } else {
        if (!adapter) throw handleError(new WalletNotSelectedError());

        if (
          !(readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable)
        ) {
          // Clear the selected wallet
          setName(null);

          if (typeof window !== 'undefined') {
            window.open(adapter.url, '_blank');
          }

          throw handleError(new WalletNotReadyError());
        }
        isConnecting.current = true;
        setConnecting(true);
        try {
          await adapter.connect();
        } catch (error: any) {
          // Clear the selected wallet
          setName(null);
          // Rethrow the error, and handleError will also be called
          throw error;
        } finally {
          setConnecting(false);
          isConnecting.current = false;
        }
      }
    },
    [isConnecting, isDisconnecting, connected, adapter, readyState, handleError, setName, name]
  );

  // Disconnect the adapter from the wallet
  const disconnect = useCallback(async () => {
    if (isDisconnecting.current) return;
    if (!adapter) return setName(null);

    isDisconnecting.current = true;
    setDisconnecting(true);
    try {
      await adapter.disconnect();
    } catch (error: any) {
      // Clear the selected wallet
      setName(null);
      // Rethrow the error, and handleError will also be called
      throw error;
    } finally {
      setDisconnecting(false);
      isDisconnecting.current = false;
    }
  }, [isDisconnecting, setName, adapter]);

  // Send a transaction using the provided connection
  const signAndSubmitTransaction = useCallback(
    async (transaction: TransactionPayload, option?: any) => {
      if (!adapter) throw handleError(new WalletNotSelectedError());
      if (!connected) throw handleError(new WalletNotConnectedError());
      const response = await adapter.signAndSubmitTransaction(transaction, option);
      return response;
    },
    [adapter, handleError, connected]
  );

  const signTransaction = useCallback(
    async (transaction: TransactionPayload, option?: any) => {
      if (!adapter) throw handleError(new WalletNotSelectedError());
      if (!connected) throw handleError(new WalletNotConnectedError());
      return adapter.signTransaction(transaction, option);
    },
    [adapter, handleError, connected]
  );

  const signMessage = useCallback(
    async (message: string) => {
      if (!adapter) throw handleError(new WalletNotSelectedError());
      if (!connected) throw handleError(new WalletNotConnectedError());
      return adapter.signMessage(message);
    },
    [adapter, handleError, connected]
  );

  return (
    <WalletContext.Provider
      value={{
        wallets,
        wallet,
        account,
        connected,
        connecting,
        disconnecting,
        autoConnect,
        select: setName,
        connect,
        disconnect,
        signAndSubmitTransaction,
        signTransaction,
        signMessage
      }}>
      {children}
    </WalletContext.Provider>
  );
};
