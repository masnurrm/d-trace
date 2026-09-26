import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  createUserSchema,
  idSchema,
  listUsersQuerySchema,
  ROLES,
  updateUserRoleSchema,
  updateUserSchema,
  type CreateUserInput,
  type ListUsersQuery,
  type Role,
  type UpdateUserInput,
  type UpdateUserRoleInput,
} from '@dtrace/shared';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { MinRole } from '../../common/decorators/roles.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { UsersService } from './users.service.js';

/**
 * Every route states its own minimum privilege. The class-level `@MinRole`
 * is the floor; individual handlers tighten it where the action is riskier.
 */
@ApiTags('users')
@Controller('users')
@MinRole(ROLES.AUDITOR)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List users (paginated, filterable)' })
  list(@Query(zodPipe(listUsersQuerySchema)) query: ListUsersQuery) {
    return this.usersService.list(query);
  }

  // Declared before ':id' so the literal path is not swallowed by the parameter.
  @Get('stats')
  @ApiOperation({ summary: 'Counts behind the user screen cards' })
  stats() {
    return this.usersService.stats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Fetch one user by id' })
  findOne(@Param('id', zodPipe(idSchema)) id: string) {
    return this.usersService.findById(id);
  }

  @Post()
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Create a user with an explicit role' })
  create(
    @Body(zodPipe(createUserSchema)) body: CreateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.usersService.create(body, actor, client);
  }

  @Patch(':id')
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Update a profile or activation state' })
  update(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateUserSchema)) body: UpdateUserInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.usersService.update(id, body, actor, client);
  }

  @Patch(':id/role')
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Change a role (revokes that user sessions)' })
  changeRole(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateUserRoleSchema)) body: UpdateUserRoleInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.usersService.changeRole(id, body.role as Role, actor, client);
  }

  @Delete(':id')
  @MinRole(ROLES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a user; the audit trail survives them' })
  async remove(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.usersService.remove(id, actor, client);
  }
}
