import { OrderStatus } from '../../../infrastructure';
import { IsEnum, IsString } from 'class-validator';
import { IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateOrderStatusDTO {
  @ApiProperty({
    description: 'Order status',
    example: 'COMPLETED',
  })
  @IsNotEmpty()
  @IsEnum(OrderStatus)
  status: OrderStatus;
}

export class UpdateOrderPaymentStatusDTO {
  @ApiProperty({
    description: 'Reference from the payment gateway',
    example: 'OGABOSS0404',
  })
  @IsNotEmpty()
  @IsString()
  reference: string;
}
