import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUDIT_ACTIONS,
  summarizeTestScript,
  type Role,
  type SaveTestScriptInput,
  type TestCaptureView,
  type TestEnvironment,
  type TestModuleView,
  type TestScenarioView,
  type TestScriptKind,
  type TestScriptStatus,
  type TestScriptView,
} from '@dtrace/shared';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/exceptions/app.exception.js';
import type { ClientInfo } from '../../common/decorators/client-info.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-request.js';
import { assertRasterImage, safeDisplayName } from '../../common/utils/raster-image.js';
import { AuditService } from '../audit/audit.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { WorkspaceAccessService } from './workspace-access.service.js';

/** Subdirectory of `UPLOAD_DIR`, so evidence never mixes with document files. */
const SUBDIR = 'test-captures';

/** The whole script row, on both sides of a save. */
const AUDIT_SELECT = {
  id: true,
  projectId: true,
  kind: true,
  appName: true,
  version: true,
  testDate: true,
  environment: true,
  content: true,
  status: true,
  submittedAt: true,
  submittedById: true,
} satisfies Prisma.TestScriptSelect;

const CAPTURE_SELECT = {
  id: true,
  projectId: true,
  kind: true,
  fileName: true,
  mimeType: true,
  sizeBytes: true,
  storageKey: true,
  uploadedById: true,
  createdAt: true,
} satisfies Prisma.TestScriptCaptureSelect;

type CaptureRow = Prisma.TestScriptCaptureGetPayload<{ select: typeof CAPTURE_SELECT }>;

/** A scenario as stored: the view's fields, with the paraf stamp as ids. */
interface StoredScenario extends Omit<TestScenarioView, 'parafByName' | 'parafAt'> {
  parafById: string | null;
  parafByName: string | null;
  parafAt: string | null;
}

interface StoredSection {
  id: string;
  name: string;
  rows: StoredScenario[];
  children?: StoredSection[];
}

interface StoredModule {
  id: string;
  name: string;
  sections: StoredSection[];
}

interface EvidenceUpload {
  originalName: string;
  mimeType: string;
  bytes: Buffer;
}

const EVIDENCE_EXTENSIONS = new Map<string, string>([
  ['application/pdf', '.pdf'],
  ['application/msword', '.doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.docx'],
  ['application/vnd.ms-excel', '.xls'],
  ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'],
  ['application/vnd.ms-powerpoint', '.ppt'],
  ['application/vnd.openxmlformats-officedocument.presentationml.presentation', '.pptx'],
  ['text/plain', '.txt'],
  ['text/csv', '.csv'],
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/gif', '.gif'],
  ['image/webp', '.webp'],
  ['application/zip', '.zip'],
]);

/**
 * The SIT and UAT scripts of a project.
 *
 * Reading needs `viewProject`; writing needs `createDocument`, the same bar as
 * Task Activity — whoever may add a document to the project may record a test
 * result in it.
 */
@Injectable()
export class TestScriptService {
  private readonly logger = new Logger(TestScriptService.name);
  private readonly dir: string;
  private readonly maxBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
    private readonly audit: AuditService,
    config: ConfigService<AppConfig, true>,
  ) {
    const upload = config.get('upload', { infer: true });
    this.dir = resolve(upload.dir, SUBDIR);
    this.maxBytes = upload.maxBytes;
  }

  async get(
    projectId: string,
    kind: TestScriptKind,
    actor: AuthenticatedUser,
  ): Promise<TestScriptView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewProject');

    const row = await this.prisma.testScript.findUnique({
      where: { projectId_kind: { projectId, kind } },
    });

    if (!row) {
      // Not written until the first save: opening a script is not a change to
      // the project, and a row per visit would put noise in the audit trail.
      const node = await this.prisma.node.findUnique({
        where: { id: nodeId },
        select: { name: true },
      });
      return {
        projectId,
        kind,
        appName: node?.name ?? '',
        version: '',
        testDate: null,
        environment: kind === 'UAT' ? 'UAT' : 'STAGING',
        status: 'DRAFT',
        submittedAt: null,
        submittedByName: null,
        modules: [starterModule()],
        captures: [],
        updatedAt: null,
      };
    }

    return this.toView(row);
  }

  async save(
    projectId: string,
    kind: TestScriptKind,
    input: SaveTestScriptInput,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<TestScriptView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    const before = await this.prisma.testScript.findUnique({
      where: { projectId_kind: { projectId, kind } },
      select: { ...AUDIT_SELECT, updatedAt: true },
    });

    // `!== undefined`, not truthiness: `null` is the caller saying "I loaded a
    // script that had never been saved", which is still a claim.
    if (input.expectedUpdatedAt !== undefined) {
      const current = before?.updatedAt.toISOString() ?? null;
      if (current !== input.expectedUpdatedAt) {
        throw AppException.conflict(
          'Test script sudah diubah di tempat lain. Muat ulang halaman lalu ulangi perubahan Anda.',
        );
      }
    }

    await this.assertCaptures(projectId, kind, input);

    const summary = summarizeTestScript(input.modules);
    if (input.submit) {
      if (summary.total === 0) {
        throw AppException.validation([
          { field: 'modules', message: 'Belum ada skenario untuk disubmit' },
        ]);
      }
      if (summary.pending > 0) {
        throw AppException.validation([
          {
            field: 'modules',
            message: `Masih ada ${summary.pending} skenario Pending. Lengkapi hasilnya sebelum submit.`,
          },
        ]);
      }
    }

    const actorName = await this.nameOf(actor.id);
    const content = stampParaf(
      input.modules,
      (before?.content as StoredModule[] | undefined) ?? [],
      { id: actor.id, name: actorName },
    );

    // Any save that is not a submit returns the script to Draft: what was
    // handed in is no longer what is on the page, and a "submitted" badge over
    // results that have since changed would be a claim nobody made.
    const status: TestScriptStatus = input.submit ? 'SUBMITTED' : 'DRAFT';
    const data = {
      appName: input.appName,
      version: input.version,
      testDate: input.testDate ? new Date(`${input.testDate}T00:00:00.000Z`) : null,
      environment: input.environment,
      content: content as unknown as Prisma.InputJsonValue,
      status,
      submittedAt: input.submit ? new Date() : null,
      submittedById: input.submit ? actor.id : null,
      updatedById: actor.id,
    };

    const row = await this.prisma.testScript.upsert({
      where: { projectId_kind: { projectId, kind } },
      create: { projectId, kind, ...data },
      update: data,
    });

    await this.audit.record({
      action: input.submit ? AUDIT_ACTIONS.TEST_SCRIPT_SUBMITTED : AUDIT_ACTIONS.TEST_SCRIPT_SAVED,
      entity: 'TestScript',
      entityId: row.id,
      actorId: actor.id,
      actorEmail: actor.email,
      ip: client.ip,
      userAgent: client.userAgent,
      before: before ? pickAudit(before) : undefined,
      after: pickAudit(row),
    });

    return this.toView(row);
  }

  async uploadCapture(
    projectId: string,
    kind: TestScriptKind,
    file: EvidenceUpload,
    actor: AuthenticatedUser,
    client: ClientInfo,
  ): Promise<TestCaptureView> {
    const nodeId = await this.access.nodeIdOfProject(projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'createDocument');

    if (file.bytes.length === 0) {
      throw AppException.validation([{ field: 'file', message: 'Berkas kosong' }]);
    }
    if (file.bytes.length > this.maxBytes) {
      throw new AppException(
        'PAYLOAD_TOO_LARGE',
        `Berkas melebihi batas ${Math.round(this.maxBytes / 1024 / 1024)} MB`,
        413,
      );
    }
    const extension = EVIDENCE_EXTENSIONS.get(file.mimeType);
    if (!extension) {
      throw AppException.validation([
        { field: 'file', message: `Jenis berkas "${file.mimeType}" tidak didukung` },
      ]);
    }
    if (file.mimeType.startsWith('image/')) assertRasterImage(file);
    const mimeType = file.mimeType;
    const storageKey = `${randomUUID()}${extension}`;

    await mkdir(this.dir, { recursive: true });
    await writeFile(join(this.dir, storageKey), file.bytes);

    try {
      const row = await this.prisma.testScriptCapture.create({
        data: {
          projectId,
          kind,
          fileName: safeDisplayName(file.originalName, 'capture'),
          mimeType,
          sizeBytes: file.bytes.length,
          storageKey,
          uploadedById: actor.id,
        },
        select: CAPTURE_SELECT,
      });

      await this.audit.record({
        action: AUDIT_ACTIONS.TEST_SCRIPT_CAPTURE_UPLOADED,
        entity: 'TestScriptCapture',
        entityId: row.id,
        actorId: actor.id,
        actorEmail: actor.email,
        ip: client.ip,
        userAgent: client.userAgent,
        after: row,
      });

      return toCaptureView(row);
    } catch (error) {
      // No row, no file: an orphan on disk is litter nobody will ever find.
      await unlink(join(this.dir, storageKey)).catch(() => undefined);
      throw error;
    }
  }

  /** The bytes of one capture, for whoever may read the project it belongs to. */
  async openCapture(
    captureId: string,
    actor: AuthenticatedUser,
  ): Promise<{ stream: ReturnType<typeof createReadStream>; capture: TestCaptureView }> {
    const row = await this.prisma.testScriptCapture.findUnique({
      where: { id: captureId },
      select: CAPTURE_SELECT,
    });
    if (!row) throw AppException.notFound('Capture');

    const nodeId = await this.access.nodeIdOfProject(row.projectId);
    await this.access.requireCapability(actor.id, actor.role as Role, nodeId, 'viewProject');

    const path = resolve(this.dir, row.storageKey);
    // `storageKey` is generated, so this should never trip; the day it does,
    // something else is wrong and reading on would be the second mistake.
    if (!path.startsWith(this.dir)) {
      this.logger.error(`Refusing to read outside the capture directory: ${row.storageKey}`);
      throw AppException.notFound('Capture');
    }

    return { stream: createReadStream(path), capture: toCaptureView(row) };
  }

  /** A row may only point at evidence uploaded to this same script. */
  private async assertCaptures(
    projectId: string,
    kind: TestScriptKind,
    input: SaveTestScriptInput,
  ): Promise<void> {
    const captureIds = (sections: SaveTestScriptInput['modules'][number]['sections']): string[] =>
      sections.flatMap((section) => [
        ...section.rows.flatMap((row) => row.captureIds),
        ...captureIds(section.children),
      ]);
    const ids = [...new Set(input.modules.flatMap((module) => captureIds(module.sections)))];
    if (ids.length === 0) return;

    const found = await this.prisma.testScriptCapture.count({
      where: { id: { in: ids }, projectId, kind },
    });
    if (found !== ids.length) {
      throw AppException.validation([
        { field: 'modules', message: 'Ada capture yang tidak ditemukan. Unggah ulang gambarnya.' },
      ]);
    }
  }

  private async nameOf(userId: string | null): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });
    return user?.name ?? null;
  }

  private async toView(row: {
    projectId: string;
    kind: string;
    appName: string;
    version: string;
    testDate: Date | null;
    environment: string;
    content: Prisma.JsonValue;
    status: string;
    submittedAt: Date | null;
    submittedById: string | null;
    updatedAt: Date;
  }): Promise<TestScriptView> {
    const stored = (Array.isArray(row.content) ? row.content : []) as unknown as StoredModule[];
    const toSection = (section: StoredSection): TestModuleView['sections'][number] => ({
      id: section.id,
      name: section.name,
      rows: (section.rows ?? []).map(({ parafById: _parafById, ...scenario }) => ({
        ...scenario,
        captureIds: scenario.captureIds ?? [],
      })),
      children: (section.children ?? []).map(toSection),
    });
    const modules: TestModuleView[] = stored.map((module) => ({
      id: module.id,
      name: module.name,
      sections: (module.sections ?? []).map(toSection),
    }));

    const idsOf = (sections: TestModuleView['sections']): string[] =>
      sections.flatMap((section) => [
        ...section.rows.flatMap((row) => row.captureIds),
        ...idsOf(section.children),
      ]);
    const captureIds = [...new Set(modules.flatMap((module) => idsOf(module.sections)))];
    const captures =
      captureIds.length === 0
        ? []
        : await this.prisma.testScriptCapture.findMany({
            where: { id: { in: captureIds } },
            select: CAPTURE_SELECT,
          });

    return {
      projectId: row.projectId,
      kind: row.kind as TestScriptKind,
      appName: row.appName,
      version: row.version,
      testDate: row.testDate ? row.testDate.toISOString().slice(0, 10) : null,
      environment: row.environment as TestEnvironment,
      status: row.status as TestScriptStatus,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      submittedByName: await this.nameOf(row.submittedById),
      modules,
      captures: captures.map(toCaptureView),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/**
 * Carries the paraf stamps over from the stored script and adds new ones.
 *
 * A row keeps the stamp it already had for as long as it stays initialled; a
 * row initialled in this save is stamped with the caller; a row un-initialled
 * loses its stamp. The browser only ever says "initialled or not" — it never
 * names who, so it cannot name somebody else.
 */
function stampParaf(
  modules: SaveTestScriptInput['modules'],
  previous: StoredModule[],
  actor: { id: string; name: string | null },
): StoredModule[] {
  const stamps = new Map<string, StoredScenario>();
  const remember = (sections: StoredSection[]) => {
    for (const section of sections) {
      for (const row of section.rows ?? []) stamps.set(row.id, row);
      remember(section.children ?? []);
    }
  };
  for (const module of previous) {
    remember(module.sections ?? []);
  }

  const now = new Date().toISOString();
  const stampSections = (sections: SaveTestScriptInput['modules'][number]['sections']): StoredSection[] =>
    sections.map((section) => ({
      id: section.id,
      name: section.name,
      rows: section.rows.map((row) => {
        const old = stamps.get(row.id);
        const kept = row.paraf && old?.paraf && old.parafAt ? old : null;
        return {
          ...row,
          parafById: row.paraf ? (kept ? kept.parafById : actor.id) : null,
          parafByName: row.paraf ? (kept ? kept.parafByName : actor.name) : null,
          parafAt: row.paraf ? (kept ? kept.parafAt : now) : null,
        };
      }),
      children: stampSections(section.children),
    }));

  return modules.map((module) => ({
    id: module.id,
    name: module.name,
    sections: stampSections(module.sections),
  }));
}

/** An empty script still shows one table to type into, not a blank page. */
function starterModule(): TestModuleView {
  return {
    id: randomUUID(),
    name: 'Modul 1',
    sections: [
      {
        id: randomUUID(),
        name: 'Skenario utama',
        children: [],
        rows: [
          {
            id: randomUUID(),
            role: '',
            type: 'POSITIVE',
            activity: '',
            input: '',
            expectedOutput: '',
            result: 'PENDING',
            notes: '',
            tester: '',
            paraf: false,
            parafByName: null,
            parafAt: null,
            captureIds: [],
          },
        ],
      },
    ],
  };
}

function pickAudit(row: Record<string, unknown>) {
  return Object.fromEntries(Object.keys(AUDIT_SELECT).map((key) => [key, row[key]]));
}

function toCaptureView(row: CaptureRow): TestCaptureView {
  return {
    id: row.id,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    createdAt: row.createdAt.toISOString(),
  };
}
