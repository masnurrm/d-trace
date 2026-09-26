import { Module } from '@nestjs/common';
import { NodeTypesController, NodesController } from './hierarchy.controller.js';
import { NodeTypesService } from './node-types.service.js';
import { NodesService } from './nodes.service.js';

/**
 * Node types and nodes ship together: the types are the grammar, the nodes are
 * the sentences, and neither is meaningful on its own.
 */
@Module({
  controllers: [NodeTypesController, NodesController],
  providers: [NodeTypesService, NodesService],
  exports: [NodeTypesService, NodesService],
})
export class HierarchyModule {}
