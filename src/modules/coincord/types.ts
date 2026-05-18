// import {
//   NetworkCollection,
//   TokenSet,
// } from '@coincord/coincord-core-sdk-wallet';
// import { TokenSetEnum, TransactionStateEnum } from './enums';

// export type CurrentTokenCollection = 'BITCOIN' | 'USDC' | 'USDT';

// export const validTokens: CurrentTokenCollection[] = [
//   'BITCOIN',
//   'USDC',
//   'USDT',
// ];
// export const validNetworks: NetworkCollection[] = [
//   'BITCOIN',
//   'LITECOIN',
//   'ETHEREUM',
//   'POLYGON',
//   'BASE',
//   'TRON',
//   'SOLANA',
// ];

// export type Event = {
//   address: { address: string };
//   address_id: string;
//   amount: number;
//   app: App;
//   app_id: string;
//   app_wallet: AppWallet;
//   app_wallet_id: string;
//   created_at: string;
//   details: string;
//   event: 'INCOMING_TRANSACTION' | 'MINED_OUTGOING_TRANSACTION';
//   id: string;
//   network: string;
//   reference: string;
//   sender_address: string;
//   token: Token;
//   token_id: string;
//   token_name: CurrentTokenCollection;
//   token_set: TokenSet;
//   transaction: Transaction;
//   transaction_id: string;
// };

// export type EventRequest = {
//   id: string;
//   address: string | Address;
//   amount: number;
//   fee: number | null;
//   created_at: string;
//   details: string;
//   event: string;
//   network: string;
//   reference: string;
//   token_name: string;
//   token_set: string;
//   transaction: {
//     id: string | null;
//     tx_hash: string | null;
//     recipient: string | null;
//   };
// };

// // RETURN TYPES
// export type TransactionCheck = {
//   amount: number;
//   app_wallet: AppWallet;
//   app_wallet_id: string;
//   fee: number;
//   hash_ref: string;
//   id: string;
//   network: NetworkCollection;
//   recipient: string;
//   token: Token;
// };

// export type Token = {
//   contract_address: string;
//   name: string;
//   token: string;
//   token_set: string;
// };

// export type AppWallet = {
//   addresses: [Address];
//   app: App;
//   app_id: string;
//   balance: number;
//   created_at: string;
//   id: string;
//   token_name: string;
//   token_set: string;
//   transactions: [Transaction];
// };

// export declare type Transaction = {
//   address: Address;
//   address_id: string;
//   amount: number;
//   created_at: string;
//   hash: string;
//   id: string;
//   meta: string;
//   recipient: string;
//   reference: string;
//   status: 'PENDING' | 'FAILED' | 'SUCCESSFUL';
//   token: Token;
//   tx_hash: string;
//   type: TransactionFlowType;
// };

// export type App = {
//   app_wallet: [AppWallet];
//   created_at: string;
//   id: string;
//   name: string;
//   webhook_url: string;
// };

// export type Address = {
//   address: string;
//   amount: number;
//   app: App;
//   app_wallet: AppWallet;
//   app_wallet_id: string;
//   created_at: string;
//   events: [Event];
//   id: string;
//   token: Token;
//   token_set: TokenSetEnum;
//   transactions: [Transaction];
// };

// export type AddressSet = {
//   BITCOIN: Address;
//   ETHEREUM: Address;
//   LITECOIN: Address;
//   MULTI_ERC: Address;
// };

// export type FeeEstimate = {
//   recipient: string;
//   token: CurrentTokenCollection;
//   value: number;
// };

// export type TransactionFlowType = 'CREDIT' | 'DEBIT';

// export type EventCategory =
//   | 'INCOMING_TRANSACTION'
//   | 'OUTGOING_TRANSACTION'
//   | 'MINED_OUTGOING_TRANSACTION';
