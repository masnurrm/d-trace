import { Module } from '@nestjs/common';
import { PermissionsController } from './permissions.controller.js';
import { PermissionsService } from './permissions.service.js';

/** Exported so enforcement points elsewhere can ask `isAllowed()`. */
@Module({
  controllers: [PermissionsController],
  providers: [PermissionsService],
  exports: [PermissionsService],
})
export class PermissionsModule {}
