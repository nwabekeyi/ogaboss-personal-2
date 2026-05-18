// import {
//   Controller,
//   Get,
//   Post,
//   Body,
//   Param,
//   Put,
//   UseInterceptors,
//   Query,
//   HttpStatus,
//   HttpCode,
// } from '@nestjs/common';
// import {
//   ApiBearerAuth,
//   ApiConsumes,
//   ApiOperation,
//   ApiResponse,
//   ApiTags,
// } from '@nestjs/swagger';
// import { OrderService } from './order.service';
// import {
//   CreateOrderDto,
//   HaveOrderedBeforeDTO,
//   OrderQueryParamDTO,
//   UpdateOrderStatusDTO,
// } from './dto';
// import { apiTags } from '../../shared';
// import { HttpExceptionInterceptor } from '../../core';
// import { Auth } from '../../core/decorators/auth.decorator';
// import { Role } from '../../common/enums/roles.enum';
// import { UserType } from '../../infrastructure';
// import { IsPublic } from '../../core/decorators/public.decorator';
// import { UpdateOrderPaymentStatusDTO } from './dto/update-order.dto';
// import { VersionedController } from '../../core/decorators';

// @ApiTags(apiTags.orders)
// @ApiBearerAuth('Bearer')
// @VersionedController(apiTags.orders)
// @UseInterceptors(HttpExceptionInterceptor)
// export class OrderController {
//   constructor(private readonly orderService: OrderService) {}

//   @IsPublic()
//   @Post()
//   @HttpCode(HttpStatus.CREATED)
//   @ApiConsumes('application/json')
//   @ApiOperation({ summary: 'Create a new order. Public' })
//   @ApiResponse({
//     status: 201,
//     description: 'The order has been successfully created.',
//   })
//   @ApiResponse({
//     status: 400,
//     description: 'NIN is required Nigerians only.',
//   })
//   @ApiResponse({
//     status: 400,
//     description: 'Invalid NIN.',
//   })
//   @ApiResponse({
//     status: 400,
//     description: 'NIN does not match phone number.',
//   })
//   create(@Body() createOrderDto: CreateOrderDto) {
//     return this.orderService.create(createOrderDto);
//   }

//   @Auth([Role.SUPER_ADMIN, Role.ADMIN], [UserType.ADMIN])
//   @Get()
//   @HttpCode(HttpStatus.OK)
//   @ApiConsumes('application/json')
//   @ApiOperation({ summary: 'Get all orders. Admin only' })
//   @ApiResponse({
//     status: 200,
//     description: 'The orders have been successfully retrieved.',
//   })
//   findAll(@Query() query: OrderQueryParamDTO) {
//     return this.orderService.findAll(query);
//   }

//   @Auth([Role.SUPER_ADMIN, Role.ADMIN], [UserType.ADMIN])
//   @Put(':id')
//   @HttpCode(HttpStatus.OK)
//   @ApiConsumes('application/json')
//   @ApiOperation({ summary: 'Update an order status. Admin only' })
//   @ApiResponse({
//     status: 200,
//     description: 'The order status has been successfully updated.',
//   })
//   update(@Param('id') id: string, @Body() data: UpdateOrderStatusDTO) {
//     return this.orderService.updateStatus(id, data);
//   }

//   @IsPublic()
//   @Post('check-user-order-exist')
//   @HttpCode(HttpStatus.OK)
//   @ApiConsumes('application/json')
//   @ApiOperation({ summary: 'Check if user has ordered before. Public' })
//   @ApiResponse({
//     status: 200,
//     description: 'The user has ordered before.',
//   })
//   @ApiResponse({
//     status: 400,
//     description: 'User has not ordered before.',
//   })
//   async checkUserOrderExist(@Body() data: HaveOrderedBeforeDTO) {
//     return this.orderService.checkUserOrderExist(data);
//   }

//   @IsPublic()
//   @Get('verify-payment')
//   @HttpCode(HttpStatus.OK)
//   @ApiConsumes('application/json')
//   @ApiOperation({ summary: 'Verify payment. Public' })
//   @ApiResponse({
//     status: 200,
//     description: 'Payment verified successfully.',
//   })
//   @ApiResponse({
//     status: 400,
//     description: 'Payment verification failed.',
//   })
//   @ApiResponse({
//     status: 400,
//     description: 'Payment reference not found.',
//   })
//   async verifyPayment(@Query() query: UpdateOrderPaymentStatusDTO) {
//     return this.orderService.verifyPayment(query.reference);
//   }

//   @Auth([Role.SUPER_ADMIN, Role.ADMIN], [UserType.ADMIN])
//   @Get(':id')
//   @HttpCode(HttpStatus.OK)
//   @ApiConsumes('application/json')
//   @ApiOperation({ summary: 'Get an order by id' })
//   @ApiResponse({
//     status: 200,
//     description: 'The order has been successfully retrieved.',
//   })
//   @ApiResponse({
//     status: 404,
//     description: 'Order not found.',
//   })
//   findOne(@Param('id') id: string) {
//     return this.orderService.findOne(id);
//   }
// }
