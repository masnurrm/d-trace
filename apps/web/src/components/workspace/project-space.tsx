'use client';

import {
  Calculator,
  Calendar,
  ClipboardList,
  FilePen,
  CalendarRange,
  FileText,
  FolderKanban,
  ListChecks,
  Pencil,
  Plus,
  Rocket,
  Shield,
  ShieldCheck,
  Trash2,
  Upload,
  Bug,
  ClipboardCheck,
  ServerCog,
  UserCheck,
  Workflow,
} from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import {
  DOCUMENT_SCREEN_PATH,
  DOCUMENT_STATUS_LABELS,
  PROJECT_STAGES,
  PROJECT_STAGE_LABELS,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABELS,
  stageIndex,
  type DocumentScreen,
  type DocumentTemplateSummary,
  type ProjectStage,
  type ProjectStatus,
  type ProjectView,
  type WorkspaceProjectSummary,
} from '@dtrace/shared';
import { useMutation } from '@tanstack/react-query';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { buildPaginationMeta } from '@dtrace/shared';
import { ApiClientError, clientFetch } from '@/lib/api/client';
import { Alert } from '@/components/ui/alert';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { STAGE_FILL } from './stage-palette';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { DataTable, PaginationBar, type Column } from '@/components/ui/data-table';
import { Dialog } from '@/components/ui/dialog';
import { DropdownMenu } from '@/components/ui/dropdown-menu';
import { SelectField, TextField } from '@/components/ui/field';
import { formatDate } from '@/lib/utils/format';
import { DateTime } from '@/components/ui/date-time';
import { cn } from '@/lib/utils/cn';
import { dynamicRoute } from '@/lib/utils/routes';
import { CreateDocumentDialog } from './create-dialogs';
import { DocumentAccessDialog } from './document-access-dialog';
import { EditProjectDialog } from './edit-project-dialog';
import { RecentlyViewedCard } from './recently-viewed-card';
import { ProjectTeam } from './project-team';
import { TeamAvatars } from './team-avatars';
import { UploadDocumentDialog } from './upload-document-dialog';

const STATUS_TONES = {
  DRAFT: 'neutral',
  ON_PROGRESS: 'info',
  REVIEW: 'warning',
  FINAL: 'success',
} as const;

/**
 * The colour a project's status carries, as a badge tone and as a dot.
 *
 * The status control is a combobox, so its closed state is a text input — the
 * name alone, with nothing to tell "On Progress" from "On Hold" at a glance.
 * The dot restores that, and it is drawn in the open list too, so the colour is
 * learned while choosing rather than only afterwards. Both halves read from
 * here so the dropdown and the read-only badge can never drift apart.
 */
const PROJECT_STATUS_STYLE: Record<
  ProjectStatus,
  { tone: BadgeProps['tone']; dot: string }
> = {
  ON_PROGRESS: { tone: 'success', dot: 'bg-emerald-500' },
  ON_HOLD: { tone: 'warning', dot: 'bg-amber-500' },
  DONE: { tone: 'info', dot: 'bg-sky-600' },
  CANCELLED: { tone: 'danger', dot: 'bg-red-500' },
};

/**
 * How many documents a page of the table holds. Fifteen, so a new project's
 * standard checklist (fourteen rows) reads on one page.
 */
const DOCUMENTS_PER_PAGE = 15;

/**
 * One icon per screen-backed row, so the doors in the document table are
 * recognisable as doors before the title is read.
 */
const SCREEN_ICON: Record<DocumentScreen, ReactNode> = {
  MANDAYS: <Calculator className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  TIMELINE: <CalendarRange className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  TASKS: <ListChecks className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  BUGS: <Bug className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  SIT_SCRIPT: <ClipboardCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  UAT_SCRIPT: <UserCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  IMPLEMENTATION_PLAN: <ServerCog className="h-3.5 w-3.5 shrink-0" aria-hidden />,
};

/**
 * Documents produced from a master template, by template code — the same key
 * the document page uses to pick its screen, and for the same reason: a title
 * can be renamed, the template it came from cannot.
 */
const TEMPLATE_ICON: Record<string, ReactNode> = {
  BPM: <Workflow className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  RRF: <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden />,
  RRF_SEC: <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />,
};

/** Every row gets one, so the column lines up instead of starting in two places. */
function documentIcon(row: ProjectView['documents'][number]): ReactNode {
  if (row.screen) return SCREEN_ICON[row.screen];
  if (row.templateCode) {
    return (
      TEMPLATE_ICON[row.templateCode] ?? <FilePen className="h-3.5 w-3.5 shrink-0" aria-hidden />
    );
  }
  return <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />;
}

/** The one action left with a colour of its own. */
const UPLOAD_TONE =
  'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950';

export interface ProjectSpaceProps {
  project: ProjectView;
  templates: DocumentTemplateSummary[];
}

/**
 * Project Space: where a project stands, and every document produced in it.
 *
 * The stepper across the top and the progress panel answer two different
 * questions that are easy to conflate. The stepper shows the stage the project
 * has been *declared* to be in — a decision someone made. The bars show how
 * many documents in each stage actually reached FINAL — what has been done.
 * A project can be declared in Deploy while Design is still half empty, and
 * showing both is what makes that visible instead of hiding it behind one number.
 */
export function ProjectSpace({ project, templates }: ProjectSpaceProps) {
  const router = useRouter();
  const [createStage, setCreateStage] = useState<ProjectStage | null>(null);
  const [savingStatus, setSavingStatus] = useState(false);
  const [accessDocument, setAccessDocument] = useState<{ id: string; title: string } | null>(null);
  const [teamOpen, setTeamOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [uploadStage, setUploadStage] = useState<ProjectStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [removing, setRemoving] = useState<{ id: string; title: string } | null>(null);

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      clientFetch(`/workspace/documents/${id}`, { method: 'PATCH', body: { title } }),
    onSuccess: () => {
      setRenaming(null);
      router.refresh();
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) =>
      clientFetch(`/workspace/documents/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setRemoving(null);
      router.refresh();
    },
  });
  /**
   * One search box across every column a reader can see, matched
   * case-insensitively. The whole document list is already in memory, so
   * filtering here costs nothing and answers instantly - no round trip to
   * decide that nothing matched.
   */
  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return project.documents;

    return project.documents.filter((document) =>
      [
        document.title,
        document.ownerName ?? '',
        PROJECT_STAGE_LABELS[document.stage],
        DOCUMENT_STATUS_LABELS[document.status],
      ]
        .join(' ')
        .toLowerCase()
        .includes(needle),
    );
  }, [project.documents, search]);

  // Deleting or filtering can leave the reader past the end; clamping beats
  // showing an empty page with a pager that says there is more.
  const totalPages = Math.max(1, Math.ceil(matches.length / DOCUMENTS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const visibleDocuments = matches.slice(
    (currentPage - 1) * DOCUMENTS_PER_PAGE,
    currentPage * DOCUMENTS_PER_PAGE,
  );

  const currentStage = stageIndex(project.stage);

  // The dialog takes the sidebar's project shape, so the two entry points into
  // "new document" share one component instead of two that drift.
  const asSummary: WorkspaceProjectSummary = {
    id: project.id,
    name: project.name,
    code: project.code,
    stage: project.stage,
    status: project.status,
    documentCount: project.documents.length,
    updatedAt: project.updatedAt,
    documents: project.documents,
  };

  async function patch(body: Record<string, unknown>) {
    setSavingStatus(true);
    setError(null);
    try {
      await clientFetch<ProjectView>(`/workspace/projects/${project.id}`, {
        method: 'PATCH',
        body,
      });
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : 'Perubahan gagal disimpan.');
    } finally {
      setSavingStatus(false);
    }
  }

  const columns: Column<ProjectView['documents'][number]>[] = [
    {
      key: 'title',
      header: 'Nama Dokumen',
      cell: (row) => (
        <Link
          href={
            row.screen
              ? dynamicRoute(
                  `/workspace/project/${project.id}/${DOCUMENT_SCREEN_PATH[row.screen]}`,
                )
              : dynamicRoute(`/workspace/dokumen/${row.id}`)
          }
          className="inline-flex items-center gap-1.5 font-medium text-sky-700 hover:underline dark:text-sky-400"
        >
          {documentIcon(row)}
          {row.title}
        </Link>
      ),
    },
    {
      key: 'updatedAt',
      header: 'Last Updated',
      cell: (row) => <DateTime value={row.updatedAt} />,
      className: 'whitespace-nowrap text-slate-500',
    },
    {
      key: 'owner',
      header: 'Owner',
      cell: (row) => row.ownerName ?? '—',
      className: 'whitespace-nowrap text-slate-500',
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge tone={STATUS_TONES[row.status]}>{DOCUMENT_STATUS_LABELS[row.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      className: 'text-right',
      cell: (row) => (
        <DropdownMenu
          label={`Aksi untuk ${row.title}`}
          actions={[
            // Renaming is how a project adjusts the seeded checklist to the
            // documents it actually produces.
            ...(project.capabilities.createDocument
              ? [
                  {
                    label: 'Ubah nama',
                    icon: <Pencil className="h-4 w-4" aria-hidden />,
                    onSelect: () => setRenaming({ id: row.id, title: row.title }),
                  },
                ]
              : []),
            // Deciding who may open a document is a management act, not an
            // editing one.
            ...(project.capabilities.manageProject
              ? [
                  {
                    label: 'Atur akses',
                    icon: <Shield className="h-4 w-4" aria-hidden />,
                    onSelect: () => setAccessDocument({ id: row.id, title: row.title }),
                  },
                ]
              : []),
            ...(project.capabilities.createDocument
              ? [
                  {
                    label: 'Hapus',
                    icon: <Trash2 className="h-4 w-4" aria-hidden />,
                    danger: true,
                    onSelect: () => setRemoving({ id: row.id, title: row.title }),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* Directly under the title: who is on this, before anything about it.
          The estimate, the schedule, the task list and the bug list used to sit
          here as buttons; they are rows in the document table now, because they
          are things this project produces and that table is the list of them. */}
      <TeamAvatars members={project.members} onOpen={() => setTeamOpen(true)} />

      {error && <Alert tone="danger">{error}</Alert>}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4">
          {/* The declared stage */}
          <Card>
            <CardBody>
              <ol className="flex items-start justify-between gap-1">
                {PROJECT_STAGES.map((stage, index) => {
                  const reached = index <= currentStage;
                  return (
                    <li key={stage} className="flex min-w-0 flex-1 flex-col items-center">
                      <div className="flex w-full items-center">
                        <span
                          className={cn(
                            'h-0.5 flex-1',
                            index === 0
                              ? 'bg-transparent'
                              : index <= currentStage
                                ? 'bg-slate-300'
                                : 'bg-slate-200 dark:bg-slate-700',
                          )}
                        />
                        <span
                          className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                            reached ? 'text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800',
                          )}
                          style={reached ? { backgroundColor: STAGE_FILL[stage] } : undefined}
                        >
                          {index + 1}
                        </span>
                        <span
                          className={cn(
                            'h-0.5 flex-1',
                            index === PROJECT_STAGES.length - 1
                              ? 'bg-transparent'
                              : index < currentStage
                                ? 'bg-slate-300'
                                : 'bg-slate-200 dark:bg-slate-700',
                          )}
                        />
                      </div>
                      <span className="mt-1 text-center text-[10px] text-slate-500">Tahapan</span>
                      <span
                        className={cn(
                          'text-center text-xs font-semibold',
                          reached
                            ? 'text-sky-700 dark:text-sky-400'
                            : 'text-slate-500 dark:text-slate-400',
                        )}
                      >
                        {PROJECT_STAGE_LABELS[stage]}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </CardBody>
          </Card>

          {/* Identity */}
          <Card>
            {project.capabilities.manageProject && (
              <CardHeader
                title="Detail project"
                description="Nama, jadwal, dan tahapan yang dinyatakan."
                action={
                  <Button
                    variant="outline"
                    size="sm"
                    leftIcon={<Pencil className="h-4 w-4" aria-hidden />}
                    onClick={() => setEditOpen(true)}
                  >
                    Ubah
                  </Button>
                }
              />
            )}
            <CardBody className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Fact icon={<FolderKanban className="h-4 w-4" />} label="Nama Project">
                {project.name}
              </Fact>
              <Fact icon={<Calendar className="h-4 w-4" />} label="Tanggal Mulai">
                {project.startsAt ? formatDate(project.startsAt) : 'Belum diisi'}
              </Fact>
              <Fact icon={<Rocket className="h-4 w-4" />} label="Target Go Live">
                {project.goLiveAt ? formatDate(project.goLiveAt) : 'Belum diisi'}
              </Fact>

              <div>
                <p className="mb-1 text-xs font-medium text-slate-500">Status Project</p>
                {project.capabilities.manageProject ? (
                  <SelectField
                    label=""
                    value={project.status}
                    disabled={savingStatus}
                    options={PROJECT_STATUSES.map((status) => ({
                      value: status,
                      label: PROJECT_STATUS_LABELS[status],
                      dot: PROJECT_STATUS_STYLE[status].dot,
                    }))}
                    onValueChange={(value) => patch({ status: value as ProjectStatus })}
                  />
                ) : (
                  <Badge tone={PROJECT_STATUS_STYLE[project.status].tone}>
                    <span
                      aria-hidden
                      className={cn(
                        'mr-1.5 inline-block size-2 rounded-full',
                        PROJECT_STATUS_STYLE[project.status].dot,
                      )}
                    />
                    {PROJECT_STATUS_LABELS[project.status]}
                  </Badge>
                )}
              </div>
            </CardBody>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader
              title="Dokumen Project"
              description="Kelola dan akses dokumen project berdasarkan tahapan."
              icon={<FileText className="h-4 w-4" aria-hidden />}
              action={
                project.capabilities.createDocument ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className={UPLOAD_TONE}
                      leftIcon={<Upload className="h-4 w-4" aria-hidden />}
                      onClick={() => setUploadStage(project.stage)}
                    >
                      Upload dokumen
                    </Button>
                    <Button
                      leftIcon={<Plus className="h-4 w-4" aria-hidden />}
                      onClick={() => setCreateStage(project.stage)}
                    >
                      Buat dokumen
                    </Button>
                  </div>
                ) : undefined
              }
            />
            <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
              <TextField
                label="Cari dokumen"
                name="document-search"
                placeholder="Nama, owner, tahap, atau status"
                className="w-72"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  // A narrower list makes the old page number meaningless.
                  setPage(1);
                }}
              />
              <p className="pb-2 text-sm text-slate-500">
                {search.trim()
                  ? `${matches.length} dari ${project.documents.length} dokumen`
                  : `Total ${project.documents.length} dokumen`}
              </p>
            </div>

            <DataTable
              columns={columns}
              rows={visibleDocuments}
              rowKey={(row) => row.id}
              caption={`Dokumen project ${project.name}`}
              emptyMessage={
                search.trim()
                  ? 'Tidak ada dokumen yang cocok dengan pencarian ini.'
                  : 'Belum ada dokumen di project ini.'
              }
            />

            {matches.length > 0 && (
              <PaginationBar
                meta={buildPaginationMeta(currentPage, DOCUMENTS_PER_PAGE, matches.length)}
                onPageChange={setPage}
              />
            )}
          </Card>
        </div>

        {/* What has actually been finished */}
        <div className="space-y-4">
          <Card>
            <CardHeader title="Progress Tahapan" description="Dihitung dari dokumen berstatus Final." />
            <CardBody className="space-y-3">
              {project.progress.map((entry, index) => (
                <div key={entry.stage} className="flex items-center gap-3">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                    style={{ backgroundColor: STAGE_FILL[entry.stage] }}
                  >
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {PROJECT_STAGE_LABELS[entry.stage]}
                    </p>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${entry.percent}%`,
                          backgroundColor: STAGE_FILL[entry.stage],
                        }}
                      />
                    </div>
                  </div>
                  <span className="w-16 shrink-0 text-right text-xs text-slate-500">
                    {entry.total === 0 ? '—' : `${entry.done}/${entry.total}`}
                  </span>
                </div>
              ))}
            </CardBody>
          </Card>

          <RecentlyViewedCard projectId={project.id} />
        </div>
      </div>

      <EditProjectDialog
        project={project}
        open={editOpen}
        onClose={() => setEditOpen(false)}
      />

      <ProjectTeam
        projectId={project.id}
        canManage={project.capabilities.manageProject}
        open={teamOpen}
        onClose={() => setTeamOpen(false)}
      />

      <Dialog
        open={renaming !== null}
        onClose={() => setRenaming(null)}
        title="Ubah nama dokumen"
        description="Nama yang muncul di daftar dokumen project."
        footer={
          <>
            <Button variant="outline" onClick={() => setRenaming(null)}>
              Batal
            </Button>
            <Button
              loading={rename.isPending}
              disabled={(renaming?.title.trim().length ?? 0) < 3}
              onClick={() => renaming && rename.mutate(renaming)}
            >
              Simpan
            </Button>
          </>
        }
      >
        <TextField
          label="Nama dokumen"
          name="document-title"
          maxLength={160}
          value={renaming?.title ?? ''}
          onChange={(event) =>
            setRenaming((current) => (current ? { ...current, title: event.target.value } : current))
          }
        />
      </Dialog>

      <Dialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title="Hapus dokumen"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Batal
            </Button>
            <Button
              variant="destructive"
              loading={remove.isPending}
              onClick={() => removing && remove.mutate(removing.id)}
            >
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-600">
          Hapus <strong className="text-slate-900">{removing?.title}</strong> dari daftar dokumen
          project ini? Dokumen ditarik dari semua daftar, tapi riwayat dan berkasnya tetap
          tersimpan untuk audit.
        </p>
      </Dialog>

      <DocumentAccessDialog document={accessDocument} onClose={() => setAccessDocument(null)} />

      <UploadDocumentDialog
        project={uploadStage ? asSummary : null}
        defaultStage={uploadStage ?? 'PREPARE'}
        onClose={() => setUploadStage(null)}
      />

      <CreateDocumentDialog
        project={createStage ? asSummary : null}
        templates={templates}
        defaultStage={createStage ?? 'PREPARE'}
        onClose={() => setCreateStage(null)}
      />
    </div>
  );
}

function Fact({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 text-slate-400" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-slate-500">{label}</p>
        <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
          {children}
        </p>
      </div>
    </div>
  );
}
