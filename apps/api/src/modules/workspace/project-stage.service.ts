import { Injectable } from '@nestjs/common';
import type { ProjectStage } from '@dtrace/shared';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Derives the project stage from the work that has actually happened.
 *
 * Checks are ordered from the latest milestone to the earliest so a project
 * never gets held at an earlier stage by data that naturally remains present.
 */
@Injectable()
export class ProjectStageService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(projectId: string): Promise<ProjectStage> {
    const [bast, implementationPlan, developmentStarted, bpm] = await Promise.all([
      this.prisma.document.findFirst({
        where: {
          projectId,
          deletedAt: null,
          OR: [
            { title: { contains: 'Berita Acara Serah Terima', mode: 'insensitive' } },
            { title: { contains: 'BAST', mode: 'insensitive' } },
          ],
          files: { some: { purpose: 'ATTACHMENT' } },
        },
        select: { id: true },
      }),
      this.prisma.implementationPlan.findUnique({
        where: { projectId },
        select: { content: true },
      }),
      this.prisma.mandayTask.findFirst({
        where: {
          plan: { projectId },
          stage: 'DEVELOP',
          actualStartsAt: { not: null },
        },
        select: { id: true },
      }),
      this.prisma.document.findFirst({
        where: {
          projectId,
          deletedAt: null,
          OR: [
            { template: { code: 'BPM' } },
            { title: { contains: 'Business Process', mode: 'insensitive' } },
          ],
        },
        select: {
          status: true,
          content: true,
          _count: { select: { versions: true } },
        },
      }),
    ]);

    const stage = deriveProjectStage({
      hasBastAttachment: Boolean(bast),
      hasImplementationStart: hasActualImplementationStart(implementationPlan?.content),
      hasDevelopmentStart: Boolean(developmentStarted),
      bpmFinal: bpm?.status === 'FINAL',
      bpmStarted: Boolean(bpm && (bpm._count.versions > 0 || hasContent(bpm.content))),
    });

    await this.prisma.project.updateMany({
      where: { id: projectId, stage: { not: stage } },
      data: { stage },
    });

    return stage;
  }
}

export function deriveProjectStage(signals: {
  hasBastAttachment: boolean;
  hasImplementationStart: boolean;
  hasDevelopmentStart: boolean;
  bpmFinal: boolean;
  bpmStarted: boolean;
}): ProjectStage {
  if (signals.hasBastAttachment) return 'COMPLETE';
  if (signals.hasImplementationStart) return 'DEPLOY';
  if (signals.hasDevelopmentStart) return 'DEVELOP';
  if (signals.bpmFinal) return 'DESIGN';
  if (signals.bpmStarted) return 'DEFINE';
  return 'PREPARE';
}

function hasContent(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

function hasActualImplementationStart(value: unknown): boolean {
  if (!Array.isArray(value)) return false;

  return value.some((phase) => {
    if (!phase || typeof phase !== 'object') return false;
    const steps = (phase as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) return false;

    return steps.some(
      (step) =>
        Boolean(step) &&
        typeof step === 'object' &&
        typeof (step as { actualStartedAt?: unknown }).actualStartedAt === 'string' &&
        (step as { actualStartedAt: string }).actualStartedAt.length > 0,
    );
  });
}
