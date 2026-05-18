// import { RetrievedType } from 'src/helpers/types/index.types';

// export class StoreService {
//   private static transactionStore: Array<any> = [];
//   private static createEmailStore: Array<any> = [];

//   async getStore(store: string): Promise<Array<any>> {
//     return StoreService[store];
//   }

//   async updateStore(store: string, index: number, payload: any) {
//     const theStore = await this.getStore(store);
//     theStore[index] = payload;
//     return theStore;
//   }

//   async clearStoreAsync(store: string, minutes: number) {
//     const theStore = await this.getStore(store);
//     setTimeout(() => {
//       theStore.splice(0);
//     }, minutes * 60 * 1000);
//   }

//   async undoClearAsync(timeout: any) {
//     clearTimeout(timeout);
//   }

//   async immediateClear(store: string) {
//     (await this.getStore(store)).splice(0);
//   }
// }
