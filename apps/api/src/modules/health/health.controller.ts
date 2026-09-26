import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Two endpoints with different jobs: `/health/live` answers "is the process
 * up" (never touches the database, so a database outage does not get the pod
 * restarted), `/health/ready` answers "can it serve traffic".
 */
@ApiTags('health')
@Controller('health')
// Liveness and readiness are polled by the orchestrator on a schedule; they
// must never be rate limited, or a restart storm becomes self-inflicted.
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.ping();
      return { database: { status: 'up' } };
    } catch {
      // The reason is deliberately vague; details go to the logs, not the probe.
      return { database: { status: 'down' } };
    }
  }
}
