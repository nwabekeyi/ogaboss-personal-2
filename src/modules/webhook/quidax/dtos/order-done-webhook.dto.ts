// src/modules/orders/dto/order-done.dto.ts

import { IsString, IsOptional, IsNumber, IsObject, IsArray } from 'class-validator';

export class MarketDTO {
  @IsString()
  id: string;

  @IsString()
  base_unit: string;

  @IsString()
  quote_unit: string;
}

export class PriceDTO {
  @IsString()
  unit: string;

  @IsString()
  amount: string;
}

export class VolumeDTO {
  @IsString()
  unit: string;

  @IsString()
  amount: string;
}

export class TradeDTO {
  @IsString()
  id: string;

  @IsObject()
  market: MarketDTO;

  @IsObject()
  price: PriceDTO;

  @IsObject()
  volume: VolumeDTO;

  @IsObject()
  total: PriceDTO;

  @IsString()
  created_at: string;

  @IsString()
  updated_at: string;
}

export class UserDTO {
  @IsString()
  id: string;

  @IsString()
  sn: string;

  @IsString()
  email: string;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string;
}

export class OrderDoneDataDTO {
  @IsString()
  id: string;

  @IsOptional()
  @IsString()
  reference?: string | null;

  @IsObject()
  market: MarketDTO;

  @IsString()
  side: 'buy' | 'sell';

  @IsString()
  order_type: string;

  @IsObject()
  price: PriceDTO;

  @IsObject()
  avg_price: PriceDTO;

  @IsObject()
  volume: VolumeDTO;

  @IsObject()
  origin_volume: VolumeDTO;

  @IsObject()
  executed_volume: VolumeDTO;

  @IsString()
  status: string;

  @IsNumber()
  trades_count: number;

  @IsString()
  created_at: string;

  @IsString()
  updated_at: string;

  @IsOptional()
  @IsString()
  done_at?: string | null;

  @IsObject()
  user: UserDTO;

  @IsArray()
  trades: TradeDTO[];
}
