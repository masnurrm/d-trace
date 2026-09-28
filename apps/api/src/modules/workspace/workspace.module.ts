import { Module } from '@nestjs/common';
import { HolidaysModule } from '../holidays/holidays.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PermissionsModule } from '../permissions/permissions.module.js';
import { BugController } from './bug.controller.js';
import { BugService } from './bug.service.js';
import { DocumentContentService } from './document-content.service.js';
import { DocumentFileService } from './document-file.service.js';
import { ImplementationPlanController } from './implementation-plan.controller.js';
import { ImplementationPlanService } from './implementation-plan.service.js';
import { MandayService } from './manday.service.js';
import { TaskService } from './task.service.js';
import { TestScriptService } from './test-script.service.js';
import { TimelineService } from './timeline.service.js';
import { ProjectDataService } from './project-data.service.js';
import { ProjectTeamService } from './project-team.service.js';
import { ProjectStageService } from './project-stage.service.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { WorkspaceController } from './workspace.controller.js';
import { WorkspaceService } from './workspace.service.js';

/**
 * Projects and documents, reached through the node grants a person holds.
 * `PermissionsModule` is imported because the grant only becomes a capability
 * once the matrix is applied to it.
 */
@Module({
  imports: [PermissionsModule, NotificationsModule, HolidaysModule],
  controllers: [WorkspaceController, ImplementationPlanController, BugController],
  providers: [
    WorkspaceService,
    WorkspaceAccessService,
    ProjectTeamService,
    ProjectStageService,
    MandayService,
    TimelineService,
    TaskService,
    BugService,
    TestScriptService,
    ImplementationPlanService,
    DocumentFileService,
    DocumentContentService,
    ProjectDataService,
  ],
  exports: [WorkspaceService, WorkspaceAccessService, ProjectTeamService, MandayService],
})
export class WorkspaceModule {}
