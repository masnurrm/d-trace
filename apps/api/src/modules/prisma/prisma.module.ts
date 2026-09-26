import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';

/** Global so feature modules need not re-import it; there is only one pool. */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
