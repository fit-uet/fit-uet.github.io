import { prepareStagingCopy } from '../server/staging/rehearsal';
const args = process.argv.slice(2);
const option = (name: string) => args.find(x => x.startsWith(`--${name}=`))?.slice(name.length + 3);
const source = option('source');
if (!source) throw new Error('Dùng: npm run academic:stage -- --source=file:/path/source-copy.db [--workbook=/path/list.xlsx] [--lecturers=/path/catalog.csv] [--resolutions=/path/resolutions.json] [--output=/path/private-dir]');
const report = await prepareStagingCopy({ source, workbook: option('workbook'), lecturers: option('lecturers'), resolutions: option('resolutions'), outputRoot: option('output') });
console.log(JSON.stringify({ directory: report.directory, sourceUnchanged: report.sourceUnchanged, sourceHasInternshipData: report.sourceHasInternshipData, preserved: report.preserved, legacyCreated: report.legacy.created, legacyBlocked: report.legacy.blocked.length, rerunCreated: report.rerunCreated, seededLecturers: report.seededLecturers, project: report.project }, null, 2));
