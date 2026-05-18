export interface PaystackTransactionResponse {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
}

export interface PaystackWebhookEvent {
  event: string;
  data: {
    id: number;
    reference: string;
    amount: number;
    status: string;
    gateway_response: string;
    paid_at: string;
    channel: string;
    currency: string;
    customer: {
      email: string;
      phone?: string;
    };
  };
}

export interface PaystackVerifyResponse {
  status: boolean;
  message: string;
  data: {
    status: string;
    reference: string;
    amount: number;
    gateway_response: string;
    channel: string;
    authorization?: {
      authorization_code: string;
      bin: string;
      last4: string;
      exp_month: number;
      exp_year: number;
      card_type: string;
      bank: string;
      brand: string;
      reusable: boolean;
      channel: string;
    };
  };
}



export interface PaystackBankVerifyResponse {
  status: boolean;
  message: string;
  data: {
    account_number: string;
    account_name: string;
    bank_id: number;
  };
}

export interface PaystackChargeSavedCardResponse {
  status: boolean;
  message: string;
  data: {
    status: string;
    reference: string;
    amount: number;
    gateway_response: string;
    channel: string;
    authorization_code: string;
  };
}

export interface PaystackRefundResponse {
  status: boolean;
  message: string;
  data: {
    status: string;
    reference: string;
    amount: number;
  };
}


export interface PaystackBalanceResponse {
  status: boolean;
  message: string;
  data: {
    currency: string;
    balance: number;
  }[];
}

export interface PaystackTransferRecipientResponse {
  status: boolean;
  message: string;
  data: {
    recipient_code: string;
    name: string;
    currency: string;
  };
}

export interface PaystackTransferResponse {
  status: boolean;
  message: string;
  data: {
    reference: string;
    transfer_code: string;
    amount: number;
    status?: string;
  };
}