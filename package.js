Package.describe({
  summary: "Allows you to define and run db migrations.",
  version: "0.7.2",
  name: "rurri:migrations",
  git: "https://github.com/rurri/meteor-migrations"
});

Package.onUse(function(api) {
  api.versionsFrom('METEOR@0.9.1.1');
  api.use('underscore', 'server');
  api.add_files(['migrations_server.js'], "server");
  api.add_files(['lib/collections.js'], ['server', 'client']);

  api.export('Migrations', 'server');
  api.export('MigrationVersions');
  api.export('MigrationLogs')
});

Package.on_test(function (api) {
  api.use(['rurri:migrations', 'tinytest']);
  api.add_files('migrations_tests.js', ['server']);
});