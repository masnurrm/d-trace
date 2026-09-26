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
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  addProjectMemberSchema,
  createDocumentSchema,
  createProjectSchema,
  idSchema,
  listDocumentsQuerySchema,
  restoreDocumentVersionSchema,
  saveDocumentContentSchema,
  saveMandayPlanSchema,
  saveProjectTaskSchema,
  saveProjectTimelineSchema,
  saveTestScriptSchema,
  TEMPLATE_IMAGE_MAX_BYTES,
  TEST_SCRIPT_KINDS,
  setDocumentAccessSchema,
  submitMandayPlanSchema,
  setFavoriteSchema,
  updateDocumentSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  type AddProjectMemberInput,
  type CreateDocumentInput,
  type CreateProjectInput,
  type ListDocumentsQuery,
  type RestoreDocumentVersionInput,
  type SaveDocumentContentInput,
  type SaveMandayPlanInput,
  type SaveProjectTaskInput,
  type SaveProjectTimelineInput,
  type SaveTestScriptInput,
  type TestScriptKind,
  type SetDocumentAccessInput,
  type SubmitMandayPlanInput,
  type SetFavoriteInput,
  type UpdateDocumentInput,
  type UpdateProjectInput,
  type UpdateProjectMemberInput,
} from '@dtrace/shared';
import { z } from 'zod';
import { Client, type ClientInfo } from '../../common/decorators/client-info.decorator.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { zodPipe } from '../../common/pipes/zod-validation.pipe.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { DocumentContentService } from './document-content.service.js';
import { DocumentFileService } from './document-file.service.js';
import { MandayService } from './manday.service.js';
import { TaskService } from './task.service.js';
import { TestScriptService } from './test-script.service.js';
import { TimelineService } from './timeline.service.js';
import { ProjectTeamService } from './project-team.service.js';
import { WorkspaceService } from './workspace.service.js';

/** `SIT` or `UAT` in the path, upper-cased so `sit` works as well. */
const testScriptKindSchema = z
  .string()
  .transform((value) => value.toUpperCase())
  .pipe(z.enum(TEST_SCRIPT_KINDS));

/** A version number in the path: 1-based, never zero. */
const versionNumberSchema = z.coerce.number().int().min(1);

/** What `FileInterceptor` hands back. Declared locally; see the note below. */
interface MultipartFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * The Workspace endpoints.
 *
 * Deliberately carry no `@Roles()` or `@MinRole()`: every signed-in account
 * has a workspace, and what they find in it is decided by their node grants,
 * not by their system role. A role guard here would be a second, coarser
 * answer to a question `WorkspaceAccessService` already answers precisely.
 */
@ApiTags('workspace')
@Controller('workspace')
export class WorkspaceController {
  constructor(
    private readonly workspace: WorkspaceService,
    private readonly team: ProjectTeamService,
    private readonly mandays: MandayService,
    private readonly timeline: TimelineService,
    private readonly tasks: TaskService,
    private readonly testScripts: TestScriptService,
    private readonly files: DocumentFileService,
    private readonly contents: DocumentContentService,
  ) {}

  @Get('tree')
  @ApiOperation({ summary: 'Nodes the caller can reach, with projects and documents' })
  tree(@CurrentUser() actor: AuthenticatedUser) {
    return this.workspace.tree(actor);
  }

  @Get('documents')
  @ApiOperation({ summary: 'Documents the caller may read, newest first' })
  listDocuments(
    @Query(zodPipe(listDocumentsQuerySchema)) query: ListDocumentsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.workspace.listDocuments(query, actor);
  }

  @Post('documents')
  @ApiOperation({ summary: 'Create a document inside a project' })
  createDocument(
    @Body(zodPipe(createDocumentSchema)) body: CreateDocumentInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.workspace.createDocument(body, actor, client);
  }

  @Patch('documents/:id')
  @ApiOperation({ summary: 'Update a document' })
  updateDocument(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateDocumentSchema)) body: UpdateDocumentInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.workspace.updateDocument(id, body, actor, client);
  }

  @Delete('documents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Withdraw a document; the row is kept for the trail' })
  removeDocument(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.workspace.removeDocument(id, actor, client);
  }

  @Post('documents/:id/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Star or unstar a document for the caller' })
  async setFavorite(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(setFavoriteSchema)) body: SetFavoriteInput,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.workspace.setFavorite(id, body.favorite, actor);
  }

  @Get('projects/:id')
  @ApiOperation({ summary: 'One project with its documents and stage progress' })
  findProject(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.workspace.findProject(id, actor);
  }

  @Post('projects')
  @ApiOperation({ summary: 'Create a project inside a node' })
  createProject(
    @Body(zodPipe(createProjectSchema)) body: CreateProjectInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.workspace.createProject(body, actor, client);
  }

  @Patch('projects/:id')
  @ApiOperation({ summary: 'Rename a project, move its stage, or change its status' })
  updateProject(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(updateProjectSchema)) body: UpdateProjectInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.workspace.updateProject(id, body, actor, client);
  }

  @Delete('projects/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project (soft); only its creator may' })
  async removeProject(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.workspace.removeProject(id, actor, client);
  }
/* ---------------------------------------------------------------- */
  /* Team                                                              */
  /* ---------------------------------------------------------------- */

  @Get('projects/:id/members')
  @ApiOperation({ summary: 'The project team, including people reached by node grant' })
  listMembers(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.team.listMembers(id, actor);
  }

  @Get('projects/:id/member-candidates')
  @ApiOperation({ summary: 'Active accounts not yet on this team' })
  listCandidates(
    @Param('id', zodPipe(idSchema)) id: string,
    @Query('search') search: string | undefined,
    @Query('page') page: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.team.listCandidates(id, actor, search, Number(page) || 1);
  }

  @Post('projects/:id/members')
  @ApiOperation({ summary: 'Add someone to the team; Collaborator unless raised' })
  addMember(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(addProjectMemberSchema)) body: AddProjectMemberInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.team.addMember(id, body, actor, client);
  }

  @Patch('projects/:id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change a member job role or project role' })
  async updateMember(
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('memberId', zodPipe(idSchema)) memberId: string,
    @Body(zodPipe(updateProjectMemberSchema)) body: UpdateProjectMemberInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.team.updateMember(id, memberId, body, actor, client);
  }

  @Delete('projects/:id/members/:memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove someone from the team' })
  async removeMember(
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('memberId', zodPipe(idSchema)) memberId: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ): Promise<void> {
    await this.team.removeMember(id, memberId, actor, client);
  }

  /* ---------------------------------------------------------------- */
  /* Per-document access                                               */
  /* ---------------------------------------------------------------- */

  @Get('documents/:id/access')
  @ApiOperation({ summary: 'Who may do what with this document' })
  documentAccess(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.team.documentAccess(id, actor);
  }

  @Put('documents/:id/access')
  @ApiOperation({ summary: 'Replace the per-member overrides on this document' })
  setDocumentAccess(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(setDocumentAccessSchema)) body: SetDocumentAccessInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.team.setDocumentAccess(id, body, actor, client);
  }

  /* ---------------------------------------------------------------- */
  /* Mandays                                                           */
  /* ---------------------------------------------------------------- */

  @Get('projects/:id/mandays')
  @ApiOperation({ summary: 'The mandays estimate, created on first open' })
  mandayPlan(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.mandays.getForProject(id, actor);
  }

  @Put('projects/:id/mandays')
  @ApiOperation({ summary: 'Replace the whole estimate grid' })
  saveMandayPlan(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveMandayPlanSchema)) body: SaveMandayPlanInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.mandays.save(id, body, actor, client);
  }

  /* ------------------------------------------------------------------ */
  /* Task Activity                                                       */
  /* ------------------------------------------------------------------ */

  @Get('projects/:id/tasks')
  @ApiOperation({ summary: 'The module task list, whole — the screen filters it' })
  projectTasks(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.tasks.listForProject(id, actor);
  }

  @Post('projects/:id/tasks')
  @ApiOperation({ summary: 'Add a task to the project' })
  createProjectTask(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveProjectTaskSchema)) body: SaveProjectTaskInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.tasks.create(id, body, actor, client);
  }

  @Put('tasks/:id')
  @ApiOperation({ summary: 'Replace a task' })
  updateProjectTask(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveProjectTaskSchema)) body: SaveProjectTaskInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.tasks.update(id, body, actor, client);
  }

  @Post('tasks/:id/duplicate')
  @ApiOperation({ summary: 'Copy a task in below the one it came from' })
  duplicateProjectTask(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.tasks.duplicate(id, actor, client);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a task' })
  removeProjectTask(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.tasks.remove(id, actor, client);
  }

  /* ------------------------------------------------------------------ */
  /* Test scripts (SIT / UAT)                                            */
  /* ------------------------------------------------------------------ */

  @Get('projects/:id/test-scripts/:kind')
  @ApiOperation({ summary: 'The SIT or UAT script, whole; an unsaved one comes back as a draft' })
  testScript(
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('kind', zodPipe(testScriptKindSchema)) kind: TestScriptKind,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.testScripts.get(id, kind, actor);
  }

  @Put('projects/:id/test-scripts/:kind')
  @ApiOperation({ summary: 'Replace the script, optionally submitting it; refuses a stale version' })
  saveTestScript(
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('kind', zodPipe(testScriptKindSchema)) kind: TestScriptKind,
    @Body(zodPipe(saveTestScriptSchema)) body: SaveTestScriptInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.testScripts.save(id, kind, body, actor, client);
  }

  @Post('projects/:id/test-scripts/:kind/captures')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload an evidence file for a test scenario' })
  uploadTestCapture(
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('kind', zodPipe(testScriptKindSchema)) kind: TestScriptKind,
    @UploadedFile() file: MultipartFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    if (!file) {
      throw AppException.validation([{ field: 'file', message: 'Berkas wajib dilampirkan' }]);
    }

    return this.testScripts.uploadCapture(
      id,
      kind,
      { originalName: file.originalname, mimeType: file.mimetype, bytes: file.buffer },
      actor,
      client,
    );
  }

  @Get('test-captures/:captureId')
  @ApiOperation({ summary: 'View or download one test evidence file' })
  async readTestCapture(
    @Param('captureId', zodPipe(idSchema)) captureId: string,
    @Query('download') download: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { stream, capture } = await this.testScripts.openCapture(captureId, actor);

    response.setHeader('Content-Type', capture.mimeType);
    response.setHeader('Content-Length', String(capture.sizeBytes));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader(
      'Content-Disposition',
      `${download === '1' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(capture.fileName)}`,
    );

    stream.pipe(response);
  }

  /* ------------------------------------------------------------------ */
  /* Timeline                                                            */
  /* ------------------------------------------------------------------ */

  @Get('projects/:id/timeline')
  @ApiOperation({ summary: 'The project schedule, over the mandays task list' })
  projectTimeline(
    @Param('id', zodPipe(idSchema)) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.timeline.getForProject(id, actor);
  }

  @Put('projects/:id/timeline')
  @ApiOperation({ summary: 'Replace the schedule; refuses a stale version' })
  saveProjectTimeline(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveProjectTimelineSchema)) body: SaveProjectTimelineInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.timeline.save(id, body, actor, client);
  }

  @Post('projects/:id/mandays/decision')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Submit the estimate, or approve/reject a submitted one' })
  decideMandayPlan(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(submitMandayPlanSchema)) body: SubmitMandayPlanInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.mandays.decide(id, body, actor, client);
  }
/* ---------------------------------------------------------------- */
  /* Files                                                             */
  /* ---------------------------------------------------------------- */

  @Get('documents/:id/files')
  @ApiOperation({ summary: 'Files attached to this document, newest first' })
  listFiles(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.files.list(id, actor);
  }

  @Post('documents/:id/files')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Attach a file to a document' })
  uploadFile(
    @Param('id', zodPipe(idSchema)) id: string,
    @UploadedFile() file: MultipartFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    if (!file) {
      throw AppException.validation([{ field: 'file', message: 'Berkas wajib dilampirkan' }]);
    }

    return this.files.attach(
      id,
      { originalName: file.originalname, mimeType: file.mimetype, bytes: file.buffer },
      actor,
      client,
    );
  }

  @Post('documents/:id/images')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: TEMPLATE_IMAGE_MAX_BYTES + 1 } }))
  @ApiOperation({ summary: 'Upload a picture to embed in a rich-text section' })
  async uploadImage(
    @Param('id', zodPipe(idSchema)) id: string,
    @UploadedFile() file: MultipartFile | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    if (!file) {
      throw AppException.validation([{ field: 'file', message: 'Gambar wajib dilampirkan' }]);
    }

    // Embedding a picture is writing into the document, so it asks what a
    // save asks — including a per-document override that took editing away.
    await this.contents.assertEditable(id, actor);

    return this.files.attachImage(
      id,
      { originalName: file.originalname, mimeType: file.mimetype, bytes: file.buffer },
      actor,
      client,
    );
  }

  @Get('files/:fileId/download')
  @ApiOperation({ summary: 'Download one attached file' })
  async downloadFile(
    @Param('fileId', zodPipe(idSchema)) fileId: string,
    @Query('inline') inline: string | undefined,
    @CurrentUser() actor: AuthenticatedUser,
    @Res() response: Response,
  ): Promise<void> {
    const { stream, file, inlineImage } = await this.files.open(fileId, actor);

    response.setHeader('Content-Type', file.mimeType);
    response.setHeader('Content-Length', String(file.sizeBytes));

    /*
     * Inline rendering is the exception, not the default, and it is granted to
     * exactly one type. An uploaded HTML or SVG file served inline runs its
     * own script against this origin with the reader's session — which is why
     * everything else stays an attachment no matter what the caller asks for.
     *
     * The hardening that matters is the pair below: the MIME allow-list means
     * only a PDF is ever offered inline, and `nosniff` stops the browser
     * deciding those bytes are really HTML after all. Together they close the
     * hole — nothing scriptable can reach this path.
     *
     * A `CSP: sandbox` header was tried here and removed: it breaks Chromium's
     * built-in PDF viewer, which is the thing rendering the file, and it
     * defends only against PDF-embedded script that the viewer already
     * refuses to run.
     */
    // The one addition since: a picture embedded in a section body. Those are
    // raster images whose bytes were sniffed on upload, so the same pair of
    // guarantees holds — nothing scriptable is ever stored under that purpose.
    const wantsInline = inline === '1' && (file.mimeType === 'application/pdf' || inlineImage);

    if (wantsInline) {
      response.setHeader('X-Content-Type-Options', 'nosniff');
    }

    response.setHeader(
      'Content-Disposition',
      `${wantsInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );

    stream.pipe(response);
  }
/* ---------------------------------------------------------------- */
  /* Contents and history                                              */
  /* ---------------------------------------------------------------- */

  @Get('documents/:id')
  @ApiOperation({ summary: 'One document: its template shape and its answers' })
  findDocument(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.contents.findById(id, actor);
  }

  @Put('documents/:id/content')
  @ApiOperation({ summary: 'Save the contents as a new version' })
  saveContent(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(saveDocumentContentSchema)) body: SaveDocumentContentInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.contents.save(id, body, actor, client);
  }

  @Get('documents/:id/versions')
  @ApiOperation({ summary: 'Every saved version, newest first' })
  listVersions(@Param('id', zodPipe(idSchema)) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.contents.listVersions(id, actor);
  }

  @Get('documents/:id/versions/:version')
  @ApiOperation({ summary: 'The contents of one version' })
  findVersion(
    @Param('id', zodPipe(idSchema)) id: string,
    @Param('version', zodPipe(versionNumberSchema)) version: number,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.contents.findVersion(id, version, actor);
  }

  @Post('documents/:id/versions/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an earlier version by appending it as a new one' })
  restoreVersion(
    @Param('id', zodPipe(idSchema)) id: string,
    @Body(zodPipe(restoreDocumentVersionSchema)) body: RestoreDocumentVersionInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Client() client: ClientInfo,
  ) {
    return this.contents.restore(id, body, actor, client);
  }
}
