export class ErrorMessages {
  static EMAIL_ALREADY_EXIST = 'Email already exist';
  static USER_EXIST = 'User already exist';
  static USER_VERIFIED = 'User already verified';
  static INCORRECT_CREDENTIALS = 'Incorrect credentials';
  static CRYPTO_CURRENCY_EXIST = 'Crypto currency already exist';
  static SUB_BUNDLE_EXIST = 'Sub bundle already exist';
  static QUESTION_EXIST = 'Question already exist';
  static ANSWER_EXIST = 'Answer already exist';
  static CURRENCY_NOT_FOUND = 'Currency not found';
  static USER_NOT_FOUND = 'User not found';
  static USER_NOT_AUTHORIZE = 'Kindly login';
  static USER_NOT_AUTHORIZE_PUBLIC = 'Kindly login as an admin';
  static OTP_EXPIRED = 'Invalid OTP or OTP expired';
  static PASSWORD_MISMATCH = 'Password mismatch';
  static USER_NOT_AUTHORIZED = 'Unathourized user';
  static ACCESS_DENIED = 'Access denied';
  static ROLE_CHANGED = 'Access denied. Role changed'
  static SERVICE_UNAVAILABLE = 'Service temporarily unavailable. Please try again later.'

  static userNotFound(id: string) {
    return `user with id ${id} not found`;
  }

  static bundleNotFound(id: string) {
    return `bundle with id ${id} not found`;
  }

  static userEmailNotFound(email: string) {
    return `${email} does not exist`;
  }

  static subBundleNotFound(id: string) {
    return `sub bundle with id ${id} not found`;
  }
}
