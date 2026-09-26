import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  saveImplementationPlanSchema,
  type SaveImplementationPlanInput,
} from '@dtrace/shared';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { ImplementationPlanService } from './implementation-plan.service.js';

/**
 * The implementation plan endpoints, under the same `/workspace` prefix as the
 * rest of the project's screens.
 *
 * Like `WorkspaceController`, no `@Roles()` or `@MinRole()`: what a person may
 * do with a project is decided by their node grant, which the service checks.
 */
@ApiTags('workspace')
@Controller('workspace')
export class ImplementationPlanController {
  constructor(private readonly plans: ImplementationPlanService) {}

  @Get('projects/:id/implementation-plan')
  @ApiOperation({ summary: 'The implementation plan, whole; an unsaved one comes back as a draft' })
  get(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.plans.get(id, actor);
  }

  @Put('projects/:id/implementation-plan')
  @ApiOperation({ summary: 'Replace the plan, optionally marking it complete; refuses a stale version' })
  save(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveImplementationPlanSchema)) body: SaveImplementationPlanInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.plans.save(id, body, actor, client);
  }
}
