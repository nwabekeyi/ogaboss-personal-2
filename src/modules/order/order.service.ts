// // src/modules/order/order.service.ts

// import {
//   BadRequestException,
//   Injectable,
//   NotFoundException,
// } from '@nestjs/common';
// import { CreateOrderDto } from './dto/create-order.dto';
// import { PrismaService } from '../../infrastructure/databases/prisma';
// import { generateTxRef, generateTransactionId } from '../../common';
// import { UpdateOrderStatusDTO } from './dto/update-order.dto';
// import { HaveOrderedBeforeDTO, OrderQueryParamDTO } from './dto';
// import { createModelQuery } from '../../common/helpers';
// import { Order, OrderStatus, PaymentStatus  } from '../../infrastructure';
// import { DojahService } from '../../infrastructure/providers/dojah/dojah.service';
// import { PaystackService } from '../../infrastructure/providers/paystack/paystack.service';
// import { config } from '../../config';
// import { QuidaxWalletService } from '../../infrastructure/providers/quidax';
// import {
//   QuidaxResponse,
//   VerifyAddressResponse,
// } from '../../infrastructure/providers/quidax';
// import { ConvertCurrency } from '../../shared';

// const buildOrderQuery = createModelQuery<Order>({
//   defaultDateField: 'createdAt',
//   defaultSortBy: 'createdAt',
//   searchMode: 'insensitive',
// });

// @Injectable()
// export class OrderService {
//   constructor(
//     private readonly prisma: PrismaService,
//     private readonly dojahService: DojahService,
//     private readonly paystackService: PaystackService,
//     private readonly quidaxWalletService: QuidaxWalletService,
//   ) {}

//   async create(createOrderDto: CreateOrderDto) {
//     const { currencyId, cryptoAmount, fiatAmount, ...rest } = createOrderDto;

//     const { data } = await this.checkUserOrderExist({
//       email: rest.email,
//       phoneNumber: rest.phoneNumber,
//     });
//     const haveOrder = data.haveOrder;
//     const requiredNin = rest.phoneNumber.startsWith('+234');
//     if (!haveOrder && requiredNin && !rest.nin) {
//       throw new BadRequestException('NIN is required for Nigerian phone numbers');
//     }

//     const currency = await this.prisma.cryptoCurrency.findUnique({
//       where: { id: currencyId },
//     });
//     if (!currency) {
//       throw new NotFoundException('Currency not found');
//     }

//     // Validate wallet address using Quidax
//     if (rest.walletAddress) {
//       const response: QuidaxResponse<VerifyAddressResponse> =
//         await this.quidaxWalletService.verifyAddress({
//           currency: currency.symbol.toLowerCase(),
//           address: rest.walletAddress,
//         });

//       if (response.status !== 'success' || !response.data?.valid) {
//         throw new BadRequestException('Invalid wallet address');
//       }
//     }

//     // Validate NIN
//     if (rest.nin) {
//       const { data } = await this.dojahService.validateNin({
//         nin: rest.nin,
//       });

//       if (!data || !data.entity) {
//         throw new BadRequestException('Invalid NIN');
//       }

//       const phoneNumber = rest.phoneNumber.startsWith('+234')
//         ? rest.phoneNumber.replace('+234', '0')
//         : rest.phoneNumber;

//       if (data.entity.phone_number !== phoneNumber) {
//         throw new BadRequestException('NIN does not match phone number');
//       }
//     }

//     // Convert to base units using correct decimals
//     const cryptoDecimals = ConvertCurrency.getDecimals(currency.symbol);
//     const fiatDecimals = rest.fiatCurrency === 'NGN' ? 2 : ConvertCurrency.getDecimals(rest.fiatCurrency);

//     const cryptoOriginal = cryptoAmount.toFixed(cryptoDecimals);
//     const fiatOriginal = fiatAmount.toFixed(fiatDecimals);

//     const order = await this.prisma.order.create({
//       data: {
//         ...rest,
//         currency: { connect: { id: currency.id } },
//         transactionId: generateTransactionId(),
//         referenceNo: generateTxRef(),
//         cryptoAmountBase: ConvertCurrency.toBase(cryptoOriginal, currency.symbol),
//         cryptoAmountOriginal: cryptoOriginal,
//         fiatAmountBase: ConvertCurrency.toBase(fiatOriginal, rest.fiatCurrency || 'NGN'),
//         fiatAmountOriginal: fiatOriginal,
//       },
//     });

//     const paystackPayload: any = {
//       email: order.email,
//       amount: Number(order.fiatAmountBase),
//       reference: order.referenceNo,
//       callback_url:
//         config.env === 'development'
//           ? `${config.frontendUrlDev}/order/verify`
//           : `${config.frontendUrlProd}/order/verify`,
//       metadata: { orderId: order.id },
//       currency: order.fiatCurrency,
//     };

//     const payment = await this.paystackService.initializePayment(paystackPayload);

//     await this.prisma.order.update({
//       where: { id: order.id },
//       data: {
//         paymentReference: payment.data.reference,
//       },
//     });

//     return {
//       message: 'Order created successfully',
//       data: {
//         order,
//         paymentUrl: payment.data.authorization_url,
//       },
//     };
//   }

//   async findAll(query: OrderQueryParamDTO) {
//     const queryOptions = buildOrderQuery({
//       ...query,
//       searchFields: ['fullName', 'phoneNumber', 'email'],
//       filters: {
//         status: query.status,
//         currencyId: query.currencyId,
//         dateRange: query.dateRange,
//         startDate: query.startDate,
//         endDate: query.endDate,
//       },
//     });

//     const [orders, total] = await Promise.all([
//       this.prisma.order.findMany(queryOptions),
//       this.prisma.order.count({ where: queryOptions.where }),
//     ]);

//     const pagination = {
//       total,
//       limit: queryOptions.take,
//       currentPage: query.page || 1,
//       totalPages: Math.ceil(total / queryOptions.take),
//       hasNext: (query.page || 1) < Math.ceil(total / queryOptions.take),
//       hasPrev: (query.page || 1) > 1,
//     };

//     return {
//       message: 'Orders retrieved successfully',
//       data: { orders, pagination },
//     };
//   }

//   async findOne(id: string) {
//     const order = await this.prisma.order.findUnique({ where: { id } });
//     if (!order) throw new NotFoundException('Order not found');
//     return { message: 'Order retrieved successfully', order };
//   }

//   async updateStatus(id: string, dto: UpdateOrderStatusDTO) {
//     const { status } = dto;
//     const order = await this.prisma.order.findUnique({ where: { id } });
//     if (!order) throw new NotFoundException('Order not found');
//     if (order.status === OrderStatus.COMPLETED) {
//       throw new BadRequestException('Order already completed');
//     }

//     const updatedOrder = await this.prisma.order.update({
//       where: { id },
//       data: { status },
//     });

//     return { message: 'Order status updated successfully', order: updatedOrder };
//   }

//   async checkUserOrderExist(dto: HaveOrderedBeforeDTO) {
//     const { email, phoneNumber } = dto;
//     const order = await this.prisma.order.findFirst({
//       where: { OR: [{ email }, { phoneNumber }] },
//     });

//     return {
//       message: order ? 'User has ordered before' : 'User has not ordered before',
//       data: { haveOrder: !!order },
//     };
//   }

//   async updateOrderPaymentStatus(
//     reference: string,
//     status: PaymentStatus,
//     paymentDetails: {
//       paymentReference: string;
//       paymentChannel?: string;
//       paymentAmount: number; // in base units (e.g., kobo for NGN)
//       paymentDate?: string;
//       gatewayResponse?: string;
//     },
//   ) {
//     const order = await this.prisma.order.findFirst({
//       where: { referenceNo: reference },
//     });

//     if (!order) throw new NotFoundException('Order not found');

//     const fiatDecimals = order.fiatCurrency === 'NGN' ? 2 : ConvertCurrency.getDecimals(order.fiatCurrency);
//     const paymentAmountOriginal = (paymentDetails.paymentAmount / Math.pow(10, fiatDecimals)).toFixed(fiatDecimals);

//     const updatedOrder = await this.prisma.order.update({
//       where: { id: order.id },
//       data: {
//         paymentStatus: status,
//         status: status === PaymentStatus.PAID ? OrderStatus.PROCESSING : order.status,
//         paymentReference: paymentDetails.paymentReference,
//         paymentChannel: paymentDetails.paymentChannel,
//         paymentAmountBase: BigInt(paymentDetails.paymentAmount),
//         paymentAmountOriginal: paymentAmountOriginal,
//         paymentDate: paymentDetails.paymentDate
//           ? new Date(paymentDetails.paymentDate)
//           : new Date(),
//         gatewayResponse: paymentDetails.gatewayResponse,
//       },
//     });

//     return updatedOrder;
//   }

//   async verifyPayment(reference: string) {
//     const verification = await this.paystackService.verifyTransaction(reference);

//     if (verification.data.status !== 'success') {
//       await this.updateOrderPaymentStatus(reference, PaymentStatus.FAILED, {
//         paymentReference: reference,
//         paymentAmount: verification.data.amount,
//         gatewayResponse: verification.data.gateway_response,
//       });
//       throw new BadRequestException('Payment verification failed');
//     }

//     await this.updateOrderPaymentStatus(reference, PaymentStatus.PAID, {
//       paymentReference: reference,
//       paymentChannel: verification.data.channel,
//       paymentAmount: verification.data.amount,
//       gatewayResponse: verification.data.gateway_response,
//     });

//     return {
//       message: 'Order payment successful',
//       data: {
//         reference,
//         amount: verification.data.amount / 100,
//         paymentMethod: verification.data.channel,
//       },
//     };
//   }
// }
