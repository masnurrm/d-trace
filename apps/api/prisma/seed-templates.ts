import { isEntryPoint, prisma, runAsScript } from './seed-client.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type {
  ApprovalConfig,
  DataConfig,
  HeaderConfig,
  InfoConfig,
  TextConfig,
} from '@dtrace/shared';

/**
 * Seeds the standard master document templates.
 *
 * A step of `npm run db:seed`, and still a script of its own for re-running
 * just this part. These are content: a template is a form somebody will edit
 * afterwards, in the app, and running this again must never undo that. So a
 * template whose `code` already exists is **left exactly as it is** — this only
 * ever fills in what is missing.
 *
 * The section configs below are the same shapes `@dtrace/shared` validates; the
 * types are imported there rather than re-declared, so a config that stopped
 * matching the contract would fail to compile rather than fail on someone's
 * screen.
 */

/** Ids only have to be unique inside one section's config. */
let counter = 0;
const id = (prefix: string) => `${prefix}${(counter += 1)}`;

type SectionSeed = Omit<Prisma.DocumentTemplateSectionCreateManyTemplateInput, 'position'>;

/* -------------------------------------------------------------------------- */
/* Release Request Form                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Section B's items, as the form lists them.
 *
 * Kept as plain data rather than spread through the config literal below,
 * because this list *is* the standard — it is the thing somebody will compare
 * against a printed form, and it should be readable as one column of text.
 */
const RELEASE_CHECKLIST: [string, string[]][] = [
  [
    'Documentation',
    [
      'Project Charter',
      'Kick-Off Meeting',
      'Release Request Form',
      'Change Request Form (CRF)',
      'Purchase Order (PO)',
      'User Requirement',
      'Business Process Model (BPM)',
      'Blueprint',
      'Non-Disclosure Agreement (NDA)',
    ],
  ],
  [
    'Testing',
    [
      'Unit/Function Test',
      'System Integration Test (SIT)',
      'User Acceptance Test (UAT)',
      'Secure Programming Test for web based apps and mobile',
      'Security Test',
    ],
  ],
  [
    'Socialization & Training',
    [
      'User Manual',
      'Training for Business User',
      'Working Instruction for IT Operation',
      'Training for IT Operation',
      'Down-Time Information',
      'Up-Time Information',
      'Meeting for Release & Integration Preparation',
    ],
  ],
  [
    'Production Environment',
    [
      'Data Readiness',
      'Production Environment Readiness',
      'Deployment Scenario',
      'Fail-Over Scenario',
    ],
  ],
  [
    'Implementation & Deployment',
    [
      'Request to Publish',
      'Source Code Hand-Over',
      'Support After Go-Live & BAST',
      'Access Sterilization',
    ],
  ],
];

/**
 * Section A, shared by every Release Request Form variant: the requester's half
 * is the same form whoever checks the other half.
 */
const generalInformationSection = (serviceTypes: string[]): SectionSeed => ({
  title: 'General Information',
  key: 'generalInformation',
  type: 'INFO',
  source: 'MANUAL',
  binding: null,
  content: null,
  editable: true,
  required: true,
  visible: true,
  config: {
    rows: [
      {
        id: id('r'),
        label: 'Service Name',
        value: '',
        mode: 'INPUT',
        span: 'half',
        field: 'TEXT',
        options: [],
        units: [],
        hint: '',
      },
      {
        id: id('r'),
        label: 'Reference',
        value: '',
        mode: 'INPUT',
        span: 'half',
        field: 'TEXT',
        options: [],
        units: [],
        hint: 'jika perlu',
      },
      {
        id: id('r'),
        label: 'Release Type',
        value: '',
        mode: 'INPUT',
        span: 'half',
        field: 'SELECT',
        options: ['Project', 'CR', 'ICR'],
        units: [],
        hint: '',
      },
      {
        id: id('r'),
        label: 'Service Type',
        value: '',
        mode: 'INPUT',
        span: 'half',
        field: 'SELECT',
        options: serviceTypes,
        units: [],
        hint: '',
      },
      {
        id: id('r'),
        label: 'Service Version',
        value: '',
        mode: 'INPUT',
        span: 'half',
        field: 'TEXT',
        options: [],
        units: [],
        hint: '',
      },
      {
        id: id('r'),
        label: 'Priority',
        value: '',
        mode: 'INPUT',
        span: 'half',
        field: 'SELECT',
        options: ['High', 'Medium', 'Low'],
        units: [],
        hint: '',
      },
      {
        id: id('r'),
        label: 'Down-Time Duration',
        value: '',
        mode: 'INPUT',
        span: 'full',
        field: 'DURATION',
        options: [],
        units: ['Jam', 'Menit'],
        hint: '',
      },
      {
        id: id('r'),
        label: 'Requested Deployment',
        value: '',
        mode: 'INPUT',
        span: 'full',
        field: 'DATETIME_RANGE',
        options: [],
        units: [],
        hint: '',
      },
      {
        id: id('r'),
        label: 'After Go-Live Support',
        value: '',
        mode: 'INPUT',
        span: 'full',
        field: 'DATE_RANGE',
        options: [],
        units: [],
        hint: '',
      },
      {
        id: id('r'),
        label: 'Impact Description',
        value: '',
        mode: 'INPUT',
        span: 'full',
        field: 'TEXTAREA',
        options: [],
        units: [],
        hint: 'jika perlu',
      },
    ],
  },
});

const releaseRequestFormSections = (): SectionSeed[] => [
  generalInformationSection(['Apps', 'Infra']),
  {
    title: 'Release Form',
    key: 'releaseForm',
    type: 'CHECKLIST',
    source: 'MANUAL',
    binding: null,
    content: null,
    editable: true,
    required: true,
    visible: true,
    config: {
      filledByLabel: 'Diisi oleh IT Operation sebagai Checker',
      showRemark: true,
      showChecker: true,
      showDate: true,
      showEvidence: true,
      groups: RELEASE_CHECKLIST.map(([title, items]) => ({
        id: id('g'),
        title,
        items: items.map((label) => ({ id: id('i'), label })),
      })),
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Release Request Form – Security Checklist                                   */
/* -------------------------------------------------------------------------- */

/**
 * Section B of the security variant: the controls IT Security verifies before
 * a release, one group per domain, each item as `[name, what it asks for]`.
 *
 * Grouped by domain rather than kept in the paper form's interleaved order —
 * the screen filters by domain, and a checker works one domain at a time.
 */
const SECURITY_CHECKLIST: [string, [string, string, number][]][] = [
  [
    'Infrastructure Security',
    [
      ['Conduct monthly port scanning (free tools: nmap).', '', 1],
      [
        'System Lifecycle\n- Operating System & Software pendukung menggunakan latest version\n\n1. QW - Internet Facing & Cloud (7) Implement Critical Patch (IT devices, OS, applications, open source softwares).\n2. QW - Internet Facing & Cloud (22) End of Life / End of Support systems Handling (Upgrade/Replace/ Hardening for additional security i.e segmentation, firewall, virtual patching, and access limitation).',
        '',
        2,
      ],
      [
        'Pastikan seluruh aktivitas administratif hanya dapat diakses melalui jaringan internal perusahaan, sehingga tidak dapat dijangkau langsung dari luar dan mengurangi risiko akses tidak sah.',
        '',
        4,
      ],
      [
        'Host-to-host communication for internal application\n- Open akses hanya ke server & port tertentu\n\n1. QW - Internet Facing & Cloud (1) Web Security - use only secure protocols (https).\n2. QW - Internet Facing & Cloud (3) Block unnecessary ports (rdp: 3389, smb:445/139/138/137, telnet: 23, ssh:22 , http:80, ftp:21, ntp: 123, smtp: 25/426, snmp: 161/162:, vnc:5900, sql:1433/1434, mysql:3306, oracle:1521 , port >1024).\n3. QW - Internal System (28) Access Control - Network Segmentation –Server vs User, Production vs Development.',
        '',
        6,
      ],
      ['Disable TLS 1.1, use latest TLS Version (minimum TLS 1.2)', '', 7],
      ['Disable SMBv1', '', 8],
      [
        'delete 3DES chiper suite from registry HKLM:  HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Control\\Cryptography\\Configuration\\Local\\SSL\\00010002\n- 3DES di registry\n- Ensure to only use the latest version of Encryption & hash for data at rest, data in transit, PII (SHA-256 and AES-256)',
        '',
        9,
      ],
      [
        'SSL Certificate https\n- Inject certificate SSL\n\n- QW - Internet Facing & Cloud (1) Web Security - use only secure protocols (https).',
        '',
        10,
      ],
      [
        'Implement Critical Patch (IT devices, OS, applications, database, open source software).',
        '',
        11,
      ],
      ['Limit number of domain admin accounts, no more than 4 accounts.', '', 25],
      [
        'Implementasi WAF untuk melindungi aplikasi dan membatasi percobaan login berulang (rate limiting)\n\nMenggunakan Web Application Firewall untuk melindungi aplikasi dari serangan berbasis web serta membatasi jumlah percobaan login dalam periode tertentu, sehingga dapat mengurangi risiko serangan seperti percobaan pembobolan akun (brute force) dan akses tidak sah.',
        '',
        26,
      ],
    ],
  ],
  [
    'Monitoring & Detection',
    [
      [
        'Engage with Managed Security Services to monitor and analyse security events\n- Ingest Server & Application Log to SIEM if needed',
        '',
        3,
      ],
      [
        'Penetration Test (before Go-Live)\nMelakukan Penetration Testing terhadap aplikasi untuk mengidentifikasi potensi celah keamanan; seluruh temuan dengan tingkat risiko Critical hingga Low wajib dilakukan remediasi, dan apabila terdapat temuan yang tidak dapat diremediasi, maka harus mendapatkan persetujuan resmi dari tim IT Security sebagai bentuk risk acceptance.',
        '',
        5,
      ],
      [
        'Melakukan Vulnerability Assesment terhadap sistem dan aplikasi untuk mengidentifikasi potensi celah keamanan; seluruh temuan dengan tingkat risiko Critical hingga Low wajib dilakukan remediasi, dan apabila terdapat temuan yang tidak dapat diremediasi, maka harus mendapatkan persetujuan resmi dari tim IT Security sebagai bentuk risk acceptance.',
        '',
        56,
      ],
    ],
  ],
  [
    'Application Security',
    [
      [
        'Multi Factor Authentication (MFA)\n• Autentikasi ganda yang dilakukan pada saat login ke aplikasi\n• Memastikan hanya pengguna yang sah yang dapat mengakses\n\n• Admin: Fitur tersedia dan wajib di-enforce\n• Employee/Vendor: Fitur tersedia dan wajib di-enforce\n• Customer: Fitur tersedia dan wajib disosialisasikan',
        '',
        12,
      ],
      [
        'Strong Password\n• Pengaturan standar aman terkait panjang minimum, kompleksitas karakter, dan masa berlaku password\n• Memastikan password sulit ditebak atau dipecahkan oleh pihak tidak sah\n\n• Cakupan: Implementasi untuk admin, employee/vendor, dan customer di seluruh aplikasi\nPanjang Password:\n– Customer, employee, vendor: minimal 8 karakter\n– Admin: 14 karakter\nKompleksitas: Mengandung karakter (A-Z, a-z, 0-9, !, @, #, $, %)\nMasa berlaku: 30 hari',
        '',
        13,
      ],
      ['Konfigurasi dari sisi aplikasi: Change Password when First Login', '', 14],
      ['Ganti Password oleh user ketika Go-Live', '', 15],
      [
        'Access Restriction\n• Pembatasan akses berdasarkan peran (role) dan pekerjaan (job) dalam organisasi (RBAC)\n• Memastikan hanya individu berwenang yang dapat mengakses sistem, aplikasi, atau data tertentu\n\n• Setiap aplikasi wajib memiliki matriks otorisasi sesuai role user, meliputi:\na. Pemisahan admin dan regular user\nb. Level admin (super admin, regular admin, dll.)\nc. Pemisahan role untuk menghindari konflik kepentingan (Segregation of Duties / SOD)\nd. Developer',
        '',
        16,
      ],
      [
        'Application Log\n• Fitur pencatatan aktivitas dalam aplikasi\n• Meningkatkan keamanan, mendeteksi potensi ancaman, serta mendukung pemulihan dan audit\n\n• Setiap aplikasi wajib mengaktifkan log, meliputi:\na. Authentication log (login & perubahan password)\nb. Transaction log (aktivitas user termasuk perubahan data kritikal seperti konfigurasi & master data)',
        '',
        17,
      ],
      [
        'Hindari penggunaan URL umum seperti “/admin” dan gunakan URL yang lebih unik serta tidak berkaitan langsung dengan fungsi admin atau nama aplikasi, untuk mengurangi kemungkinan akses oleh pihak yang tidak berwenang. (contoh: /c3nd0lp3jat3n)',
        '',
        18,
      ],
      ['Akun admin menggunakan username yang disamarkan (alias)', '', 19],
      ['Pembatasan unggahan file berdasarkan ekstensi yang diizinkan.', '', 20],
      [
        'Implement strict server-side input validation and output encoding for all user inputs.',
        '',
        21,
      ],
      [
        'Ensure proper error handling without exposing stack trace or sensitive system information.',
        '',
        22,
      ],
      ['Ensure no hardcoded credentials, secrets, or API keys in codebase.', '', 23],
      [
        'Restricted Access untuk Penggunaan Public Source Code Repositories\na. Daftar repositori public dan private yang digunakan oleh tim development.\nb. Bukti access control implementation yang membatasi penggunaan public repositories',
        '',
        24,
      ],
    ],
  ],
  [
    'Identitiy & Access Management',
    [
      [
        'Activate Multifactor Authentication (MFA) for: Administrator accounts (cloud admin, global admin, organization admin).',
        '',
        27,
      ],
      [
        'Activate Multifactor Authentication (MFA) for: Remote Access or VPN connections (priority for admin account).',
        '',
        28,
      ],
      ['Credential account Testing tidak boleh disimpan pada repositori', '', 29],
      [
        'Activate Multifactor Authentication (MFA) for: O365 (or Google Workspace) accounts.',
        '',
        30,
      ],
      [
        '1. Limit number of administrator accounts including cloud admin, global admin, organization admin no more than 4 accounts.\n2. Manage contributor admin accounts and restrict the access as needed.\n3. Use separate account for normal user account and privilege account.',
        '',
        31,
      ],
      [
        'Access Control - AD Hardening (set configuration based on Microsoft AD security baseline)',
        '',
        32,
      ],
      [
        'Access Control - Ensure database account and server instance account (i.e MSSQL, Oracle, etc) having minimum privileges granted (not as DBA or local admin accounts)',
        '',
        33,
      ],
      [
        'Access Control - Use a jump host (or Privilege Access Management -PAM) to establish administrator access to servers',
        '',
        34,
      ],
      [
        'Access Control - Restrict sharing folder to everyone and block saving executable files.',
        '',
        35,
      ],
      ['Access Control - Regular scan for sensitive files on open shared folders.', '', 36],
      [
        'Access Control - Ensure password policy block common word and guessable password (i.e. Using Azure AD Password Protection)',
        '',
        37,
      ],
    ],
  ],
  [
    'Email Security',
    [
      ['Email Security - Antivirus/Antimalware', '', 38],
      ['Email Security - Antispam', '', 39],
      ['Email Security - URL Protection at time of click', '', 40],
      ['Email Security - Tags or marks e-mails from outside the organization', '', 41],
      ['Email Security - Sender Policy Framework (SPF)', '', 42],
      [
        'Email Security - Block attachment file type (e.g., exe; vbs; msi) based on company policy',
        '',
        43,
      ],
      [
        'Email Security - Multi Factor Authentication (MFA) used for all remote access to email',
        '',
        44,
      ],
      ['Email Security - Secure Simple Mail Transfer Protocol (Secure SMTP)', '', 45],
      [
        'Email Security - Domain-based Message Authentication Reporting & Conformance (DMARC)',
        '',
        46,
      ],
      ['Email Security - Domain Keys Identified Mail (DKIM)', '', 47],
      ['Email Security - Email containing sensitive information is encrypted', '', 48],
    ],
  ],
  [
    'Endpoint Security',
    [
      ['Access Control - Block malicious PowerShell script (using EDR)', '', 49],
      [
        'Wajib menggunakan EDR\n- Instalasi EDR pada server terkait & dillakukan full scan\n\n1. QW - Internet Facing & Cloud (24) Implement Endpoint Detection & Response (EDR) on cloud IaaS.\n2. QW - Internal System (27) Implement Endpoint Detection & Response (EDR) (priority on critical servers and high risk function/clients).',
        '',
        50,
      ],
      ['Access Control - Ensure macro in office documents from external are blocked.', '', 51],
    ],
  ],
  [
    'Data Security & Backup',
    [
      [
        'Implement backup controls - Ensure adequacy of backup system for recovery in case of cyber incidents (RTO and RPO are according to business risk appetite)',
        '',
        52,
      ],
      ['Implement backup controls - Periodic Restore testing including recovery scenario.', '', 53],
      ['Implement backup controls - Backup admin accounts not using domain accounts', '', 54],
      [
        'Implement backup controls - Offline backup or immutable storage as last defence against ransomware',
        '',
        55,
      ],
    ],
  ],
];

const securityChecklistSections = (): SectionSeed[] => [
  generalInformationSection(['Application', 'Infrastructure']),
  {
    title: 'Security Checklist',
    key: 'securityChecklist',
    type: 'CHECKLIST',
    source: 'MANUAL',
    binding: null,
    content: null,
    editable: true,
    required: true,
    visible: true,
    config: {
      filledByLabel: 'Diisi oleh IT Security sebagai Checker',
      showRemark: true,
      showChecker: true,
      showDate: true,
      showEvidence: true,
      groups: SECURITY_CHECKLIST.map(([title, items]) => ({
        id: id('g'),
        title,
        items: items.map(([label, description, position]) => ({
          id: `sec-${position}`,
          label,
          description,
          position,
        })),
      })),
    },
  },
];

/* -------------------------------------------------------------------------- */
/* Business Process Mapping                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The BPM, laid out after `BPM_Sample_ESS-HR.docx` and the signed PDF it
 * produced.
 *
 * What the project already knows is bound rather than typed: the number
 * prefix is the project department's code, Company and Application come from
 * the node tree, Proposed by is the team's Technical Lead, and the two
 * mandays tables are DATA sections over the estimate and the timeline. What
 * only the author knows — the BPM and CRF numbers, the user and dept head,
 * the scope — is a blank.
 */
const bpmSections = (assets: SeedAssets): SectionSeed[] => [
  {
    title: 'Document Header',
    key: 'header',
    type: 'HEADER',
    source: 'SYSTEM',
    config: {
      confidentialLabel: '',
      logoText: 'agit',
      logoAssetId: assets.agitLogo,
      centerLines: [
        'BPM No.',
        '{{hierarchy.PROJECT_DEPARTMENT.code}} – ({{input:Nomor BPM}})',
        '({{input:Nomor CRF}})',
      ],
      rightLines: ['Microsoft Solution Center', 'Astra Graphia - IT'],
      centerBoldLines: 2,
      rightBoldLines: 1,
      documentTitle: 'BUSINESS PROCESS MAPPING',
      titleLabel: 'Title',
      titleValue: '{{project.name}}',
    } satisfies HeaderConfig,
  },
  {
    title: 'Project Information',
    key: 'projectInfo',
    type: 'INFO',
    source: 'MIXED',
    config: {
      rows: [
        infoRow('User Name', 'half'),
        infoRow('Phone/HP/Email', 'half'),
        infoRow('Dept. Head', 'half'),
        infoRow('Phone/HP/Email', 'half'),
        infoRow('Company', 'full', '{{hierarchy.COMPANY_PROJECT_DEPARTMENT.name}}'),
        infoRow('Proposed by', 'full', '{{team.TL.name}}'),
        infoRow('Application', 'full', '{{node.name}}'),
      ],
    } satisfies InfoConfig,
  },
  textSection(
    'scopeOfWork',
    'Statement Scope of Work',
    'Jelaskan scope pekerjaan secara umum, fitur yang dihasilkan, dan daftar poin/modul yang akan dikembangkan.',
    8,
  ),
  textSection(
    'background',
    'Business Process Justification (Background)',
    'Kebutuhan bisnis yang melatarbelakangi pekerjaan ini.',
    4,
  ),
  textSection(
    'designFlow',
    'Design Flow',
    'Sisipkan gambar flow (tombol Gambar) beserta keterangan "Gambar 1. …", lalu Penjelasan Flow dan detail tiap modul — tabel Detail | Flow dan Keterangan bisa dibuat dengan tombol Tabel.',
    14,
  ),
  {
    title: 'Effort & Resource Needed',
    key: 'effortResource',
    type: 'DATA',
    source: 'PROJECT',
    binding: 'mandays.effort',
    config: {
      dataset: 'MANDAY_EFFORT',
      intro: '',
      showWeeks: true,
      showResources: true,
    } satisfies DataConfig,
  },
  {
    title: 'Plan & Activity',
    key: 'planActivity',
    type: 'DATA',
    source: 'PROJECT',
    binding: 'mandays.activity',
    config: {
      dataset: 'MANDAY_ACTIVITY',
      intro:
        'Aktivitas yang akan dilakukan selama project dilaksanakan dijelaskan pada tabel di bawah ini.',
      showWeeks: true,
      showResources: true,
    } satisfies DataConfig,
  },
  textSection(
    'infrastructure',
    'Software, Hardware and Infrastructure Request',
    'Kebutuhan server, network, lisensi software, dan infrastruktur lain.',
    3,
  ),
  textSection('businessBenefit', 'Business Benefit', 'Manfaat bisnis yang diharapkan.', 3),
  {
    title: 'Approval',
    key: 'approval',
    type: 'APPROVAL',
    source: 'MANUAL',
    config: {
      columns: [
        approvalColumn('Microsoft Technical Lead,'),
        approvalColumn('Technical Advisor,'),
        approvalColumn('User Representative,'),
      ],
      boxHeight: 90,
    } satisfies ApprovalConfig,
  },
];

function infoRow(label: string, span: 'half' | 'full', value = ''): InfoConfig['rows'][number] {
  return {
    id: id('bpm'),
    label,
    // A `{{binding}}` on an INPUT row is a suggestion the author can overwrite.
    value,
    mode: 'INPUT',
    span,
    field: 'TEXT',
    options: [],
    units: [],
    hint: '',
  };
}

function textSection(
  key: string,
  title: string,
  placeholder: string,
  minRows: number,
): SectionSeed {
  return {
    title,
    key,
    type: 'TEXT',
    source: 'MANUAL',
    content: '',
    config: { placeholder, minRows } satisfies TextConfig,
  };
}

function approvalColumn(label: string): ApprovalConfig['columns'][number] {
  return { id: id('sig'), label, prefix: 'Approved by', name: '', mode: 'INPUT', showDate: true };
}

/** Files a template points at, created once and reused on every run. */
interface SeedAssets {
  agitLogo: string | null;
}

const AGIT_LOGO = { file: 'agit-logo.jpg', mimeType: 'image/jpeg' };

/**
 * Puts the agit logo where uploaded template images live, once.
 *
 * Found again by name on later runs, so re-seeding does not pile up copies.
 * A missing source file is a warning, not a failure: the header falls back to
 * its logo text, which is what it showed before there was a logo.
 */
async function ensureAssets(): Promise<SeedAssets> {
  const existing = await prisma.documentTemplateAsset.findFirst({
    where: { fileName: AGIT_LOGO.file, uploadedById: null },
    select: { id: true },
  });
  if (existing) return { agitLogo: existing.id };

  const source = join(import.meta.dirname, 'assets', AGIT_LOGO.file);
  let bytes: Buffer;
  try {
    bytes = await readFile(source);
  } catch {
    console.warn(`! ${source} tidak ditemukan; header BPM memakai teks logo.`);
    return { agitLogo: null };
  }

  // Same directory and naming rule as TemplateAssetService. Seeds sit outside
  // the config layer and read the environment the way DATABASE_URL is read.
  const dir = resolve(process.env['UPLOAD_DIR'] ?? './storage/uploads', 'template-assets');
  const storageKey = `${randomUUID()}.jpg`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, storageKey), bytes);

  const asset = await prisma.documentTemplateAsset.create({
    data: {
      fileName: AGIT_LOGO.file,
      mimeType: AGIT_LOGO.mimeType,
      sizeBytes: bytes.length,
      storageKey,
    },
    select: { id: true },
  });
  console.log(`+ logo ${AGIT_LOGO.file} disimpan sebagai aset template.`);
  return { agitLogo: asset.id };
}

interface TemplateSeed {
  code: string;
  name: string;
  version: string;
  description: string;
  sections: (assets: SeedAssets) => SectionSeed[];
}

const TEMPLATES: TemplateSeed[] = [
  {
    code: 'RRF',
    name: 'Release Request Form',
    version: '1.0',
    description:
      'Form rilis layanan IT: informasi umum dari Requester, dan checklist verifikasi 29 item oleh IT Operation sebagai Checker.',
    sections: releaseRequestFormSections,
  },
  {
    code: 'RRF_SEC',
    name: 'Release Request Form – Security Checklist',
    version: '1.0',
    description:
      'Form rilis layanan IT: informasi umum dari Requester, dan security checklist 56 item di 7 domain oleh IT Security sebagai Checker.',
    sections: securityChecklistSections,
  },
  {
    code: 'BPM',
    name: 'BPM - Business Process Mapping',
    version: '1.0',
    description:
      'Business Process Mapping: kop BPM/CRF, informasi user, scope, design flow dengan gambar dan tabel, effort & plan dari Mandays, dan approval tiga pihak.',
    sections: bpmSections,
  },
];

/**
 * Documents that were created before their template existed, by title.
 *
 * A project seeds "Security Checklist" whether or not `RRF_SEC` has been seeded
 * yet; one created in the gap is a blank template-less document. Linking it
 * afterwards is safe only while nobody has written in it — a document with a
 * version already has answers in some other shape, and those are left alone.
 */
const LINK_BLANK_DOCUMENTS: { title: string; templateCode: string }[] = [
  { title: 'Release Readiness Checklist', templateCode: 'RRF' },
  { title: 'Security Checklist', templateCode: 'RRF_SEC' },
];

async function linkBlankDocuments(): Promise<void> {
  for (const link of LINK_BLANK_DOCUMENTS) {
    const template = await prisma.documentTemplate.findUnique({
      where: { code: link.templateCode },
      select: { id: true, isActive: true },
    });
    if (!template?.isActive) continue;

    const documents = await prisma.document.findMany({
      where: {
        title: link.title,
        templateId: null,
        screen: null,
        deletedAt: null,
        versions: { none: {} },
        files: { none: {} },
      },
      select: { id: true },
    });

    for (const document of documents) {
      await prisma.$transaction([
        prisma.document.update({
          where: { id: document.id },
          data: { templateId: template.id },
        }),
        prisma.auditLog.create({
          data: {
            action: 'DOCUMENT_UPDATED',
            entity: 'Document',
            entityId: document.id,
            actorEmail: 'seed:templates',
            before: { templateId: null },
            after: { templateId: template.id },
          },
        }),
      ]);
    }

    if (documents.length > 0) {
      console.log(
        `~ ${documents.length} dokumen "${link.title}" ditautkan ke ${link.templateCode}.`,
      );
    }
  }
}

/**
 * `SEED_REPLACE=BPM,RRF` — the one way to overwrite a template that exists.
 *
 * Explicit and per code, because the default has to stay "never undo what
 * somebody edited in the app". Replacing keeps the template row (documents
 * stay linked) and every section whose key survives (their ids stay put);
 * only the section list and its configs are rewritten.
 *
 * An environment variable rather than a flag: this runs through two layers of
 * `npm run`, and npm reads `--replace` as an abbreviation of its own option.
 */
const REPLACE = new Set(
  (process.env['SEED_REPLACE'] ?? '')
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter(Boolean),
);

async function replaceSections(templateId: string, template: TemplateSeed, assets: SeedAssets) {
  const before = await prisma.documentTemplate.findUniqueOrThrow({
    where: { id: templateId },
    select: { name: true, version: true, sections: { select: { key: true, type: true } } },
  });
  const seeds = template.sections(assets);
  const keys = seeds.map((section) => section.key);

  await prisma.$transaction(async (tx) => {
    await tx.documentTemplateSection.deleteMany({
      where: { templateId, key: { notIn: keys } },
    });

    for (const [position, section] of seeds.entries()) {
      await tx.documentTemplateSection.upsert({
        where: { templateId_key: { templateId, key: section.key } },
        update: { ...section, position },
        create: { ...section, position, templateId },
      });
    }

    await tx.documentTemplate.update({
      where: { id: templateId },
      data: { description: template.description },
    });

    await tx.auditLog.create({
      data: {
        action: 'DOCUMENT_TEMPLATE_UPDATED',
        entity: 'DocumentTemplate',
        entityId: templateId,
        actorEmail: 'seed:templates',
        before: { sections: before.sections },
        after: { sections: seeds.map(({ key, type }) => ({ key, type })) },
      },
    });
  });

  console.log(`~ ${template.code} (${before.name}) diganti dengan ${seeds.length} section.`);
}

export async function seedTemplates(): Promise<void> {
  const assets = await ensureAssets();

  for (const template of TEMPLATES) {
    const existing = await prisma.documentTemplate.findUnique({
      where: { code: template.code },
      select: { id: true, name: true },
    });

    if (existing && REPLACE.has(template.code)) {
      await replaceSections(existing.id, template, assets);
      continue;
    }

    if (existing) {
      console.log(`- ${template.code} (${existing.name}) sudah ada, dilewati.`);
      continue;
    }

    const created = await prisma.documentTemplate.create({
      data: {
        code: template.code,
        name: template.name,
        version: template.version,
        description: template.description,
        isActive: true,
        sections: {
          createMany: {
            data: template.sections(assets).map((section, position) => ({ ...section, position })),
          },
        },
      },
      select: { id: true, _count: { select: { sections: true } } },
    });

    console.log(
      `+ ${template.code} (${template.name}) dibuat dengan ${created._count.sections} section.`,
    );
  }

  await linkBlankDocuments();
}

if (isEntryPoint(import.meta.url)) runAsScript(seedTemplates);
