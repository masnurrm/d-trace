import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { listAuditLogsQuerySchema, ROLES, type ListAuditLogsQuery } from '@dtrace/shared';
import { MinRole } from '../../common/decorators/roles.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AuditService } from './audit.service.js';

/**
 * Read-only by design: there is no endpoint that writes or edits the trail,
 * because a trail an operator can edit is not evidence.
 */
@ApiTags('audit')
@Controller('audit-logs')
@MinRole(ROLES.AUDITOR)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @ApiOkResponse({ description: 'Paginated audit trail, newest first.' })
  list(@Query(zodPipe(listAuditLogsQuerySchema)) query: ListAuditLogsQuery) {
    return this.auditService.list(query);
  }
}
