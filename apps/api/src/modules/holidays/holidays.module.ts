import { Module } from '@nestjs/common';
import { HolidaysController } from './holidays.controller.js';
import { HolidaysService } from './holidays.service.js';

/** Exported because the timeline scheduler needs the same calendar. */
@Module({
  controllers: [HolidaysController],
  providers: [HolidaysService],
  exports: [HolidaysService],
})
export class HolidaysModule {}
