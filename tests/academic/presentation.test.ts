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
  assert.ok(project.includes('students'));assert.ok(!project.includes('assignments')&&!project.includes('grades')&&!project.includes('reports'));
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

test('compact navigation keeps every permitted function reachable on desktop and mobile', async () => {
  const {campaignNavigation} = await import('../../src/features/academic/campaignPresentation');
  for (const role of ['admin','lecturer','student']) for (const internship of [false,true]) {
    const modules = campaignModules(role==='admin', role==='student', internship);
    for (const wide of [true,false]) {
      const nav = campaignNavigation(modules, role, internship, wide);
      const ids = [...nav.primary,...nav.more].map(m=>m.id);
      assert.equal(new Set(ids).size, modules.length);
      assert.deepEqual([...ids].sort(), modules.map(m=>m.id).sort());
      if (!wide) assert.equal(nav.primary.length, 2);
      if (role==='student') assert.equal(nav.primary[0].label, 'Hồ sơ');
    }
  }
  const {campaignSwitchQuery} = await import('../../src/features/academic/campaignPresentation');
  const query = new URLSearchParams('tab=grades&view=lecturer&classId=old&q=An&page=7&topicStatus=pending&enrollmentId=other&panel=grades');
  assert.equal(campaignSwitchQuery(query,campaignModules(false,false,true),true).toString(),'tab=grades&view=lecturer');
  assert.equal(campaignSwitchQuery(query,campaignModules(false,true,false),false).toString(),'');
  assert.equal(campaignQuery(new URLSearchParams('tab=reports&advisor=Alpha&page=4'),{tab:'students'}).has('advisor'),false);
  assert.equal(campaignQuery(new URLSearchParams('tab=reports&advisor=Alpha&page=4'),{advisor:'Beta'}).has('page'),false);
});
