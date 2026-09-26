import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  idSchema,
  saveBugSchema,
  updateBugStatusSchema,
  type SaveBugInput,
  type UpdateBugStatusInput,
} from '@dtrace/shared';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { BugService } from './bug.service.js';

/**
 * The Bug & Issue list endpoints, under the same `/workspace` prefix as the
 * rest of the project's screens.
 *
 * Like `WorkspaceController`, no `@Roles()` or `@MinRole()`: what a person may
 * do with a project's bugs is the ISSUE rows of their node grant, which the
 * service checks.
 */
@ApiTags('workspace')
@Controller('workspace')
export class BugController {
  constructor(private readonly bugs: BugService) {}

  @Get('projects/:id/bugs')
  @ApiOperation({ summary: 'The bug list, whole, with the environment the project has reached' })
  list(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.bugs.listForProject(id, actor);
  }

  @Post('projects/:id/bugs')
  @ApiOperation({ summary: 'Report a bug' })
  create(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveBugSchema)) body: SaveBugInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.bugs.create(id, body, actor, client);
  }

  @Put('bugs/:id')
  @ApiOperation({ summary: 'Replace a bug' })
  update(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveBugSchema)) body: SaveBugInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.bugs.update(id, body, actor, client);
  }

  @Patch('bugs/:id/status')
  @ApiOperation({ summary: 'Move a bug along the flow, touching nothing else' })
  updateStatus(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateBugStatusSchema)) body: UpdateBugStatusInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.bugs.updateStatus(id, body.status, actor, client);
  }

  @Delete('bugs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a bug from the list; its number is never reused' })
  remove(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.bugs.remove(id, actor, client);
  }
}
