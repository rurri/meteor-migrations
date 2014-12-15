/*
  Adds migration capabilities. Migrations are defined like:

  Migrations.add({
    up: function() {}, //*required* code to run to migrate upwards
    version: 1, //*required* number to identify migration order
    down: function() {}, //*optional* code to run to migrate downwards
    name: 'Something' //*optional* display name for the migration
  });

  The ordering of migrations is determined by the version you set.

  To run the migrations, set the MIGRATE environment variable to either
  'latest' or the version number you want to migrate to. Optionally, append
  ',exit' if you want the migrations to exit the meteor process, e.g if you're
  migrating from a script (remember to pass the --once parameter).

  e.g:
  MIGRATE="latest" mrt # ensure we'll be at the latest version and run the app
  MIGRATE="latest,exit" mrt --once # ensure we'll be at the latest version and exit
  MIGRATE="2,exit" mrt --once # migrate to version 2 and exit

  Note: Migrations will lock ensuring only 1 app can be migrating at once. If
  a migration crashes, the control record in the migrations collection will
  remain locked and at the version it was at previously, however the db could
  be in an inconsistant state.
*/


Migrations = {
  _list : []
};

Meteor.startup(function () {
  //Always try to add our default Migration of version 0.
  var DefaultMigration = {version: 0, description:'Initial Version', up: function(){}};
  var defaultLog = MigrationLogs.findOne({_id:'_current'});
  if (!defaultLog) {
    MigrationLogs.insert({_id: '_current', logs: []});
  }
  Migrations.add(DefaultMigration);
  if (process.env.MIGRATE)
    Migrations.migrateTo(process.env.MIGRATE);
});

// Add a new migration:
// {up: function *required
//  version: Number *required
//  down: function *optional
//  name: String *optional
// }
Migrations.add = function(migration) {
  if (typeof migration.up !== 'function')
    throw new Meteor.Error('Migration must supply an up function.');

  if (typeof migration.version !== 'number')
    throw new Meteor.Error('Migration must supply a version number.');

  if (typeof migration.description !== 'string')
    throw new Meteor.Error('Migration must supply a description.');

  if (migration.version < 0)
    throw new Meteor.Error('Migration version must be greater than 0');

  if (_.indexOf(_.map(Migrations._list, function(migration) {return migration.version}), migration.version) > -1)
    throw new Meteor.Error('Only one migration is allowed per version number');

  this._list.push(migration);
  MigrationVersions.upsert({version: migration.version}, {version:migration.version, description:migration.description});
  this._list = _.sortBy(this._list, function(m) {return m.version;});
};

// Attempts to run the migrations using command in the form of:
// e.g 'latest', 'latest,exit', 2
// use 'XX,rerun' to re-run the migration at that version
Migrations.migrateTo = function(command) {
  if (! command || command == '' || this._list.length === 0)
    return;

  if (typeof command === 'number') {
    var version = command;
  } else {
    var version = command.split(',')[0];
    var subcommand = command.split(',')[1];
  }

  if (version === 'latest') {
    this._migrateTo(_.last(this._list).version);
  } else {
    this._migrateTo(parseInt(version), (subcommand === 'rerun'));
  }

  // remember to run meteor with --once otherwise it will restart
  if (subcommand === 'exit')
    process.exit(0); 
};

// just returns the current version
Migrations.getVersion = function() {
  return this._getControl().version;
};

Migrations.log = function(text) {
  MigrationLogs.update({_id:'_current'}, {$push: {logs: {datetime: new Date(), line: text}}});
  console.log(text);
};

// migrates to the specific version passed in
Migrations._migrateTo = function(version, rerun) {
  var self = this;
  var control = this._getControl();
  var currentVersion = control.version;
  var startVersion = currentVersion;
  MigrationLogs.update( {_id: '_current'}, {$set: {logs: []}} );

  if (rerun) {
    Migrations.log('Rerunning version ' + version);
    setLocked(true);
    migrate('up', version);
    setLocked(false);
    Migrations.log('Finished migrating.');
    return;
  }

  if (currentVersion === version) {
    Migrations.log('Not migrating, already at version ' + version);
    return;
  }

  if (control.locked) {
    Migrations.log('Not migrating, control is locked.');
    return;
  }

  var startIdx = this._findIndexByVersion(currentVersion);
  var endIdx = this._findIndexByVersion(version);

  // console.log('startIdx:' + startIdx + ' endIdx:' + endIdx);
  Migrations.log('Migrating from version ' + this._list[startIdx].version
    + ' -> ' + this._list[endIdx].version);

  // run the actual migration
  function migrate(direction, idx) {
    var migration = self._list[idx];
    
    if (typeof migration[direction] !== 'function') {
      throw new Meteor.Error('Cannot migrate ' + direction + ' on version ' 
        + migration.version);
    }

    function maybeName() { 
      return migration.name ? ' (' + migration.name + ')' : '';
    }

    Migrations.log('Running ' + direction + '() on version ' + migration.version + maybeName());
    migration[direction].call();

  }

  // sets the current version to be locked/unlocked
  function setLocked(locked) {
    self._setControl({version:currentVersion, locked: locked});
  }

  setLocked(true);
  if (currentVersion < version) {
    for (var i = startIdx;i < endIdx;i++) {
      migrate('up', i + 1);
      currentVersion = self._list[i + 1].version;
      setLocked(true);
    }
  } else {
    for (var i = startIdx;i > endIdx;i--) {
      migrate('down', i);
      currentVersion = self._list[i - 1].version;
      setLocked(true);
    }
  }
  Migrations.log('Finished migration.');

  var currentLog = MigrationLogs.findOne({_id:'_current'});
  var history = {
    datetime: new Date(),
    logs: currentLog.logs,
    startVersion: startVersion,
    targetVersion: version,
    endingVersion: currentVersion,
    rerun: !!rerun
  };

  MigrationLogs.insert(history);
  setLocked(false);
};

// gets the current control record, optionally creating it if non-existant
Migrations._getControl = function() {  
  var control = MigrationVersions.findOne({_id: 'control'});
  return control || this._setControl({version: 0, locked: false});
};

// sets the control record
Migrations._setControl = function(control) {
  // be quite strict
  check(control.version, Number);
  check(control.locked, Boolean);

  MigrationVersions.update({_id: 'control'},
    {$set: {version: control.version, locked: control.locked}}, {upsert: true});

  return control;
};

// returns the migration index in _list or throws if not found
Migrations._findIndexByVersion = function(version) {
  for (var i = 0;i < this._list.length;i++) {
    if (this._list[i].version === version)
      return i; 
  }

  throw new Meteor.Error('Can\'t find migration version ' + version);
};

//reset (mainly intended for tests)
Migrations._reset = function() {
  this._list = [{version: 0, up: function(){}}];
  MigrationVersions.remove({});
};