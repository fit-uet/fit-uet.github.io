import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campaignModules, campaignQuery } from '../../src/features/academic/campaignPresentation';
import { matchesCourseCode } from '../../src/shared/utils/format';

test('campaign navigation preserves common filters but drops incompatible state between functions', () => {
  const query = new URLSearchParams({ tab: 'reports', courseCode: 'INT3132', classId: 'class-a', lecturerId: '7', q: 'An', page: '3', status: 'notSubmitted', enrollmentId: 'record-a', panel: 'reports', view: 'requests' });
  const next = campaignQuery(query, { tab: 'grades' });
  for (const field of ['courseCode', 'classId', 'lecturerId', 'q']) assert.equal(next.get(field), query.get(field));
  for (const field of ['page', 'status', 'enrollmentId', 'panel', 'view']) assert.equal(next.has(field), false);
  assert.equal(query.get('page'), '3');
  assert.equal(campaignQuery(new URLSearchParams({ tab: 'students', view: 'lecturer' }), { tab: 'grades' }).get('view'), 'lecturer');
  assert.equal(campaignQuery(query, { enrollmentId: 'record-b', panel: 'grades' }).get('page'), '3');
  assert.equal(campaignQuery(query, { q: 'Bình' }).has('page'), false);
});

test('function cards respect course group and role without exposing management to students or lecturers', () => {
  const project = campaignModules(true, false, false).map(x => x.id);
  assert.ok(project.includes('assignments') && project.includes('grades'));
  assert.ok(!project.includes('registrations') && !project.includes('final-internships'));
  assert.ok(campaignModules(true, false, true).some(x => x.id === 'registrations'));
  assert.deepEqual(campaignModules(false, true, false).map(x => x.id), ['students', 'plan', 'chat', 'questions']);
  assert.ok(campaignModules(false, false, false).every(x => !['settings', 'assignments', 'announcements'].includes(x.id)));
});

test('legacy course filters match canonical codes against stored full names without mixing subjects', () => {
  assert.equal(matchesCourseCode('Thực tập Doanh nghiệp INT4002', 'INT4002'), true);
  assert.equal(matchesCourseCode('INT4002', 'Thực tập Doanh nghiệp INT4002'), true);
  assert.equal(matchesCourseCode('Thực tập Chuyên ngành INT3508', 'INT4002'), false);
  assert.equal(matchesCourseCode('INT40020', 'INT4002'), false);
  assert.equal(matchesCourseCode(null, 'INT4002'), false);
  assert.equal(matchesCourseCode(null, ''), true);
});
