// import CoreWalletSDK, {
//   NetworkCollection,
//   TokenSet,
// } from '@coincord/coincord-core-sdk-wallet';
// import * as dotenv from 'dotenv';
// import {
//   Address,
//   AddressSet,
//   App,
//   CurrentTokenCollection,
//   Event,
//   FeeEstimate,
//   Transaction,
//   TransactionCheck,
// } from './types';
// import { SendTokenCheckDto } from 'src/modules/transactions/dto/sendTokenCheck.dto';

// dotenv.config();

// export class CoincordService {
//   private static coincordCoreClient = new CoreWalletSDK();

//   static getService() {
//     return CoincordService.coincordCoreClient;
//   }

//   static async getApp(): Promise<App> {
//     return CoincordService.coincordCoreClient.getApp();
//   }

//   static async createAddress(
//     network: NetworkCollection,
//     token: TokenSet,
//   ): Promise<Address> {
//     return await CoincordService.coincordCoreClient.createAddress(
//       network,
//       token,
//     );
//   }

//   static async createAddressCollection(uniqueId: string): Promise<AddressSet> {
//     return await CoincordService.coincordCoreClient.createAddressCollection(
//       uniqueId,
//     );
//   }

//   static async getFeeEstimate(
//     token: CurrentTokenCollection,
//     value: number,
//     recipient: string,
//     network: NetworkCollection,
//   ): Promise<FeeEstimate> {
//     return await CoincordService.coincordCoreClient.getFeeEstimate(
//       token,
//       value,
//       recipient,
//       network,
//     );
//   }

//   static async sendTokenCheck(
//     sendTokenCheckDto: SendTokenCheckDto,
//   ): Promise<TransactionCheck> {
//     return await CoincordService.coincordCoreClient.sendTokenCheck(
//       sendTokenCheckDto,
//     );
//   }

//   static async confirmTransaction(hash_ref: any): Promise<Transaction> {
//     return await CoincordService.coincordCoreClient.processTransaction({
//       hash_ref,
//     });
//   }

//   static async getEvents(
//     token: CurrentTokenCollection,
//     address: string,
//   ): Promise<Array<Event>> {
//     return await CoincordService.coincordCoreClient.getEvents(token, address);
//   }

//   static async updateAppDetails(): Promise<App> {
//     // const app = await CoincordService.getApp();
//     // const { name } = app;
//     return await CoincordService.coincordCoreClient.updateAppDetails({
//       name: process.env.APP_NAME,
//       api_key: process.env.COINCORD_CORE_HOST_API_KEY,
//       webhook_url: `${process.env.COINCORD_CORE_HOST_BASE_URL}/webhooks/coincord`,
//     });
//   }

//   static async generateClientToken() {
//     return await CoincordService.coincordCoreClient.generateClientSecret();
//   }
// }
