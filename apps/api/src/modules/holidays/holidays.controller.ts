import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ROLES,
  createHolidaySchema,
  idSchema,
  listHolidaysQuerySchema,
  syncHolidaysSchema,
  type CreateHolidayInput,
  type ListHolidaysQuery,
  type SyncHolidaysInput,
} from '@dtrace/shared';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { MinRole } from '../../common/decorators/roles.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { HolidaysService } from './holidays.service.js';

/**
 * Reading is open to anyone signed in — the timeline needs it to shade a
 * calendar. Changing the calendar is a platform decision, so it is
 * SUPER_ADMIN only: a holiday added here moves every project's schedule.
 */
@ApiTags('holidays')
@Controller('holidays')
export class HolidaysController {
  constructor(private readonly holidays: HolidaysService) {}

  @Get()
  @ApiOperation({ summary: 'Holidays for one year and country' })
  list(@Query(zodPipe(listHolidaysQuerySchema)) query: ListHolidaysQuery) {
    return this.holidays.list(query);
  }

  @Post('sync')
  @MinRole(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Replace the imported holidays from the public calendar' })
  sync(
    @Body(zodPipe(syncHolidaysSchema)) body: SyncHolidaysInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.holidays.sync(body, actor, client);
  }

  @Post()
  @MinRole(ROLES.SUPER_ADMIN)
  @ApiOperation({ summary: 'Add one holiday by hand' })
  create(
    @Body(zodPipe(createHolidaySchema)) body: CreateHolidayInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.holidays.create(body, actor, client);
  }

  @Delete(':id')
  @MinRole(ROLES.SUPER_ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one holiday' })
  remove(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.holidays.remove(id, actor, client);
  }
}
