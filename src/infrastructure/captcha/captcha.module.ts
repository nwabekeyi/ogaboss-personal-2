import { Module, Global } from '@nestjs/common';
import { CaptchaService } from './captcha.service';
import { HttpModule } from '../httpService/httpService.module';

@Global()
@Module({
  imports: [HttpModule],
  providers: [CaptchaService],
  exports: [CaptchaService],
})
export class CaptchaModule {}
