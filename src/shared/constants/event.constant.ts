export const Events = {
  USER_SIGNUP: 'auth.user.signup',
  USER_EMAIL_VERIFIED: 'auth.user.email.verified',
  USER_FORGOT_PASSWORD: 'auth.user.forgot.password',
  WALLET_CREATED: 'quidax.wallet.created',
  USER_SIGNUP_COMPLETED: 'user.signup.completed',
  USER_INITIATE_SIGNUP: 'user.initiate.signup',
  USER_CREATE_QUIDAX_ACCOUNT: 'user.create.quidax.account',
  LIST_WALLET_BALANCES: 'quidax.list.wallet.balances',
  USER_REQUEST_DELETE_ACCOUNT: 'user.request.delete.account',
} as const;
