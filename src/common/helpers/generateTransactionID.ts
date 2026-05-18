export const generateTransactionId = (): string => {
  const prefix = '#';
  const number = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, '0');
  return `${prefix}${number}`;
};
