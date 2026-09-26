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
  ROLES,
  createNodeSchema,
  createNodeTypeSchema,
  idSchema,
  listNodesQuerySchema,
  moveNodeSchema,
  setNodeActivationSchema,
  updateNodeSchema,
  updateNodeTypeSchema,
  type CreateNodeInput,
  type CreateNodeTypeInput,
  type ListNodesQuery,
  type MoveNodeInput,
  type SetNodeActivationInput,
  type UpdateNodeInput,
  type UpdateNodeTypeInput,
} from '@dtrace/shared';
import { z } from 'zod';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { MinRole } from '../../common/decorators/roles.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { NodeTypesService } from './node-types.service.js';
import { NodesService } from './nodes.service.js';

const includeInactiveSchema = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
  .default(false);

/**
 * Reading the hierarchy is open from AUDITOR up — it is the map everyone needs
 * to interpret a record. Changing its shape is ADMIN only.
 */
@ApiTags('hierarchy')
@Controller('node-types')
@MinRole(ROLES.AUDITOR)
export class NodeTypesController {
  constructor(private readonly nodeTypesService: NodeTypesService) {}

  @Get()
  @ApiOperation({ summary: 'List node types and their placement rules' })
  list(@Query('includeInactive', zodPipe(includeInactiveSchema)) includeInactive: boolean) {
    return this.nodeTypesService.list(includeInactive);
  }

  @Post()
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Create a node type' })
  create(
    @Body(zodPipe(createNodeTypeSchema)) body: CreateNodeTypeInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.nodeTypesService.create(body, actor, client);
  }

  @Patch(':id')
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Update a node type, including where it may be placed' })
  update(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateNodeTypeSchema)) body: UpdateNodeTypeInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.nodeTypesService.update(id, body, actor, client);
  }

  @Delete(':id')
  @MinRole(ROLES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a node type that nothing uses' })
  async remove(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.nodeTypesService.remove(id, actor, client);
  }
}

@ApiTags('hierarchy')
@Controller('nodes')
@MinRole(ROLES.AUDITOR)
export class NodesController {
  constructor(private readonly nodesService: NodesService) {}

  @Get()
  @ApiOperation({ summary: 'The whole hierarchy, flat; the client builds the tree' })
  list(@Query(zodPipe(listNodesQuerySchema)) query: ListNodesQuery) {
    return this.nodesService.list(query);
  }

  @Post()
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Create a node, at the root or under a parent' })
  create(
    @Body(zodPipe(createNodeSchema)) body: CreateNodeInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.nodesService.create(body, actor, client);
  }

  // Declared before ':id' so the literal path is not swallowed by the parameter.
  @Post('activation')
  @MinRole(ROLES.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Activate or deactivate nodes; deactivation cascades down' })
  setActivation(
    @Body(zodPipe(setNodeActivationSchema)) body: SetNodeActivationInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.nodesService.setActivation(body, actor, client);
  }

  @Patch(':id')
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Rename a node or change its type' })
  update(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateNodeSchema)) body: UpdateNodeInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.nodesService.update(id, body, actor, client);
  }

  @Patch(':id/move')
  @MinRole(ROLES.ADMIN)
  @ApiOperation({ summary: 'Re-parent a node together with its branch' })
  move(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(moveNodeSchema)) body: MoveNodeInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.nodesService.move(id, body, actor, client);
  }

  @Delete(':id')
  @MinRole(ROLES.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a leaf node' })
  async remove(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.nodesService.remove(id, actor, client);
  }
}
