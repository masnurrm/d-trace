import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ROLES,
  updatePermissionMatrixSchema,
  type UpdatePermissionMatrixInput,
} from '@dtrace/shared';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { MinRole } from '../../common/decorators/roles.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { PermissionsService } from './permissions.service.js';

/**
 * The project permission matrix: policy, not membership.
 *
 * Saving it grants nothing to anybody — it only decides what each project role
 * is capable of once someone actually holds that role.
 */
@ApiTags('permissions')
@Controller('role-permissions')
@MinRole(ROLES.AUDITOR)
export class PermissionsController {
  constructor(private readonly permissionsService: PermissionsService) {}

  @Get()
  @ApiOkResponse({ description: 'The matrix, with defaults filled in.' })
  get() {
    return this.permissionsService.get();
  }

  @Put()
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Replace the matrix; only changed cells are written' })
  update(
    @Body(zodPipe(updatePermissionMatrixSchema)) body: UpdatePermissionMatrixInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.permissionsService.update(body, actor, client);
  }
}
