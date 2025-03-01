import {
  WalletConnectionError,
  WalletDisconnectionError,
  WalletNotConnectedError,
  WalletNotReadyError,
  WalletSignAndSubmitMessageError,
  WalletSignMessageError,
  WalletSignTransactionError
} from '../WalletProviders/errors';
import Web3, { Web3ProviderType } from '@fewcha/web3';
import {
  AccountKeys,
  BaseWalletAdapter,
  scopePollingDetectionStrategy,
  WalletName,
  WalletReadyState
} from './BaseAdapter';
import { TransactionPayload, HexEncodedBytes, EntryFunctionPayload } from 'aptos/src/generated';

export const FewchaWalletName = 'Fewcha' as WalletName<'Fewcha'>;

interface FewchaWindow extends Window {
  fewcha: Web3ProviderType;
}

declare const window: FewchaWindow;

export interface FewchaAdapterConfig {
  provider?: string;
  // network?: WalletAdapterNetwork;
  timeout?: number;
}

export class FewchaWalletAdapter extends BaseWalletAdapter {
  name = FewchaWalletName;

  url = 'https://fewcha.app/';

  icon = 'https://miro.medium.com/fit/c/176/176/1*a0WaY-q7gjCRiuryRG6TkQ.png';

  protected _provider: Web3ProviderType | undefined;

  // protected _network: WalletAdapterNetwork;
  protected _timeout: number;

  protected _readyState: WalletReadyState =
    typeof window === 'undefined' || typeof document === 'undefined'
      ? WalletReadyState.Unsupported
      : WalletReadyState.NotDetected;

  protected _connecting: boolean;

  protected _wallet: any | null;

  constructor({
    // provider = WEBWALLET_URL,
    // network = WalletAdapterNetwork.Mainnet,
    timeout = 10000
  }: FewchaAdapterConfig = {}) {
    super();

    // this._network = network;
    this._timeout = timeout;
    this._connecting = false;
    this._wallet = null;
    // this._readyState = WalletReadyState.Installed;

    if (typeof window !== 'undefined' && this._readyState !== WalletReadyState.Unsupported) {
      scopePollingDetectionStrategy(() => {
        if (window.fewcha) {
          this._readyState = WalletReadyState.Installed;
          this.emit('readyStateChange', this._readyState);
          return true;
        }
        return false;
      });
    }
  }

  get publicAccount(): AccountKeys {
    return {
      publicKey: this._wallet?.publicKey || null,
      address: this._wallet?.address || null,
      authKey: this._wallet?.authKey || null
    };
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return !!this._wallet?.connected;
  }

  get readyState(): WalletReadyState {
    return this._readyState;
  }

  async connect(): Promise<void> {
    try {
      if (this.connected || this.connecting) return;
      if (
        !(
          this._readyState === WalletReadyState.Loadable ||
          this._readyState === WalletReadyState.Installed
        )
      )
        throw new WalletNotReadyError();

      this._connecting = true;
      const provider = new Web3().action;
      const isConnected = await provider.isConnected();
      if (isConnected?.data === true) {
        await provider.disconnect();
      }
      const response = await provider.connect();
      if (response.status === 401) {
        throw new WalletConnectionError('User has rejected the connection');
      } else if (response.status !== 200) {
        throw new WalletConnectionError('Wallet connect issue');
      }
      let accountDetail = { ...response.data };

      if (!accountDetail.publicKey) {
        const accountResp = await provider.account();
        if (!accountResp.data.publicKey) {
          throw new WalletConnectionError('Wallet connect issue', response.data);
        }
        accountDetail = { ...accountResp.data };
      }
      this._wallet = {
        connected: true,
        ...accountDetail
      };
      this._provider = provider;
      this.emit('connect', this._wallet.publicKey);
    } catch (error: any) {
      this.emit('error', error);
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const provider = this._provider || window.fewcha;
    if (provider) {
      try {
        const isDisconnected = await provider.disconnect();
        if (isDisconnected.data === true) {
          this._provider = undefined;
          this._wallet = null;
        } else {
          throw new Error('Disconnect failed');
        }
      } catch (error: any) {
        this.emit('error', new WalletDisconnectionError(error?.message, error));
        throw error;
      }
    }
    this.emit('disconnect');
  }

  async signTransaction(transaction: TransactionPayload): Promise<Uint8Array> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      const provider = this._provider || window.fewcha;
      const tx = await provider.generateTransaction(transaction as EntryFunctionPayload);
      if (!tx) throw new Error('Cannot generate transaction');
      const response = await provider?.signTransaction(tx.data);

      if (!response || response.status !== 200) {
        throw new Error('No response');
      }
      return response.data;
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : error.response.data.message;
      this.emit('error', new WalletSignTransactionError(errMsg));
      throw error;
    }
  }

  async signAndSubmitTransaction(
    transaction: TransactionPayload
  ): Promise<{ hash: HexEncodedBytes }> {
    try {
      const wallet = this._wallet;
      if (!wallet) throw new WalletNotConnectedError();

      const provider = this._provider || window.fewcha;
      const tx = await provider.generateTransaction(transaction as EntryFunctionPayload);
      if (!tx) throw new Error('Cannot generate transaction');
      const response = await provider?.signAndSubmitTransaction(tx.data);
      if (response.status === 401) {
        throw new Error('User has rejected the transaction');
      } else if (response.status !== 200) {
        throw new Error('Transaction issue');
      }
      return {
        hash: response.data
      };
    } catch (error: any) {
      const errMsg = error instanceof Error ? error.message : error.response.data.message;
      this.emit('error', new WalletSignAndSubmitMessageError(errMsg));
      throw error;
    }
  }

  async signMessage(message: string): Promise<string> {
    try {
      const wallet = this._wallet;
      const provider = this._provider || window.fewcha;
      if (!wallet || !provider) throw new WalletNotConnectedError();
      const response = await provider?.signMessage(message);
      if (response) {
        return response.data;
      } else {
        throw new Error('Sign Message failed');
      }
    } catch (error: any) {
      const errMsg = error.message;
      this.emit('error', new WalletSignMessageError(errMsg));
      throw error;
    }
  }
}
