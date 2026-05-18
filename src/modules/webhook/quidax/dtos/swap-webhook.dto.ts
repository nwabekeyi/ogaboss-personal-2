import {
    IsString,
    IsOptional,
    IsBoolean,
    IsNumber,
    ValidateNested,
    IsArray,
    IsDateString,
  } from 'class-validator';
  import { Type } from 'class-transformer';
  

  export class SwapUserDto {
    @IsString()
    id: string;
  
    @IsString()
    sn: string;
  
    @IsString()
    email: string;
  
    @IsOptional()
    @IsString()
    reference?: string | null;
  
    @IsOptional()
    @IsString()
    first_name?: string;
  
    @IsOptional()
    @IsString()
    last_name?: string;
  
    @IsOptional()
    @IsString()
    display_name?: string | null;
  
    @IsDateString()
    created_at: string;
  
    @IsDateString()
    updated_at: string;
  }
  
  // Swap Quotation (embedded in the webhook payload)
  export class SwapQuotationDto {
    @IsString()
    id: string;
  
    @IsString()
    from_currency: string;
  
    @IsString()
    to_currency: string;
  
    @IsString()
    quoted_price: string;
  
    @IsString()
    quoted_currency: string;
  
    @IsString()
    from_amount: string;
  
    @IsString()
    to_amount: string;
  
    @IsBoolean()
    confirmed: boolean;
  
    @IsDateString()
    expires_at: string;
  
    @IsDateString()
    created_at: string;
  
    @IsDateString()
    updated_at: string;
  
    @ValidateNested()
    @Type(() => SwapUserDto)
    user: SwapUserDto;
  }

  export class SwapWebhookDataDto {
    @IsString()
    id: string;
  
    @IsString()
    from_currency: string;
  
    @IsString()
    to_currency: string;
  
    @IsString()
    from_amount: string;
  
    @IsString()
    received_amount: string;
  
    @IsString()
    execution_price: string;
  
    @IsString()
    status: string;
  
    @IsDateString()
    created_at: string;
  
    @IsDateString()
    updated_at: string;
  
    @ValidateNested()
    @Type(() => SwapQuotationDto)
    swap_quotation: SwapQuotationDto;
  
    @ValidateNested()
    @Type(() => SwapUserDto)
    user: SwapUserDto;
  }

  
  export class SwapWebhookDto {
    @IsString()
    event: string;
  
    @ValidateNested()
    @Type(() => SwapWebhookDataDto)
    data: SwapWebhookDataDto;
  }