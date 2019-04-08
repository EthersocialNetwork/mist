const _ = require('underscore');
const builder = require('electron-builder');
const del = require('del');
const { exec, execSync } = require('child_process');
const fs = require('fs');
const gulp = require('gulp');
const babel = require('gulp-babel');
const options = require('../gulpfile.js').options;
const path = require('path');
const Q = require('bluebird');
const shell = require('shelljs');
const version = require('../package.json').version;

var settings = {};
try {
  _.extend(settings, require('../local.json'));
} catch (error) {
  _.extend(settings, require('../default.json'));
}

const type = options.type;
const applicationName = options.wallet ? settings.walletName : 'Mist';

settings.appId = `${settings.appPrefix}.${type}`;

gulp.task('clean-dist', cb => {
  return del([`./dist_${type}`], cb);
});

gulp.task('copy-app-source-files', () => {
  return gulp
    .src(
      [
        'node_modules/**/*',
        './clientBinaries.json',
        './tests/**/*.*',
        `./icons/${type}/*`,
        './sounds/*',
        './errorPages/*',
        'customProtocols.js',
        'wallet/**/*',
        '!node_modules/electron/',
        '!node_modules/electron/**/*',
        '!./tests/**/*'
      ],
      {
        base: './'
      }
    )
    .pipe(gulp.dest(`./dist_${type}/app`));
});

gulp.task('transpile-main', () => {
  return gulp
    .src('./main.js')
    .pipe(babel({ presets: ['es2016-node5'] }))
    .pipe(gulp.dest(`./dist_${type}/app`));
});

gulp.task('transpile-modules', () => {
  return gulp
    .src('./modules/**')
    .pipe(babel({ presets: ['es2016-node5'] }))
    .pipe(gulp.dest(`./dist_${type}/app/modules`));
});

gulp.task('copy-build-folder-files', () => {
  let imgSrcDir = './';
  if (settings.imgSrcDir) {
    imgSrcDir = settings.imgSrcDir;
  }

  // copy all custom icons
  gulp.src([`${imgSrcDir}icons/${type}/icon*`])
    .pipe(gulp.dest(`./dist_${type}/app/icons/${type}`));

  return gulp
    .src([`${imgSrcDir}icons/${type}/*`, `${imgSrcDir}interface/public/images/dmg-background.jpg`])
    .pipe(gulp.dest(`./dist_${type}/build`));
});

gulp.task('switch-production', cb => {
  var config = {
    production: true,
    mode: type
  };
  const appPath = path.join(__dirname, `../dist_${type}`, 'app');
  shell.mkdir('-p', appPath);
  config.public = settings;
  fs.writeFile(
    `./dist_${type}/app/config.json`,
    JSON.stringify(config),
    cb
  );
});

gulp.task('pack-wallet', cb => {
  del(['./wallet']).then(() => {
    const srcPath = path.resolve('meteor-dapp-wallet');

    if (!fs.existsSync(srcPath)) {
      throw new Error(
        `${srcPath} could not be found. Did you run "git submodule update --recursive?"`
      );
    }

    console.log('Use local wallet at meteor-dapp-wallet/app');
    const configPath = path.resolve(`dist_${type}/app/config.json`);
    const walletPath = path.resolve('wallet');
    let opts = options.debug ? '--debug ' : '';
    opts += options.verbose ? '--verbose' : '';
    let cmd = exec(
      `yarn run meteor-build-client ${walletPath} -s ${configPath} -p " " ${opts}`,
      { cwd: 'meteor-dapp-wallet/app', maxBuffer: 700*1024 },
      (err, stdout, stderr) => {
        console.log(stderr);
        cb(err);
      }
    );
    cmd.stdout.pipe(process.stdout);
  });
});

// Currently, Mist and Ethereum Wallet expects ./wallet/ to be in different paths. This task aims to fulfill this requirement.
gulp.task('move-wallet', cb => {
  if (type === 'wallet') {
    console.debug('Moving ./wallet to ./interface/wallet');
    const basePath = path.join('dist_wallet', 'app');
    const fromPath = path.join(basePath, 'wallet');
    const toPath = path.join(basePath, 'interface', 'wallet');
    shell.mv(fromPath, toPath);
  }
  cb();
});

gulp.task('build-interface', cb => {
  const interfaceBuildPath = path.resolve('build-interface');
  const configPath = path.resolve(`dist_${type}/app/config.json`);
  let opts = options.debug ? '--debug ' : '';
  opts += options.verbose ? '--verbose' : '';
  let cmd = exec(
    `yarn run meteor-build-client ${interfaceBuildPath} -s ${configPath} -p " " ${opts}`,
    { cwd: 'interface', maxBuffer: 700*1024 },
    (err, stdout, error) => {
      console.log(error);
      cb(err);
    }
  );
  cmd.stdout.pipe(process.stdout);
});

gulp.task('copy-interface', () => {
  return gulp
    .src(['build-interface/**/*'])
    .pipe(gulp.dest(`dist_${type}/app/interface`, { mode: 0644 }));
});

gulp.task('custom-interface', () => {
  let imgSrcDir = './';
  if (settings.imgSrcDir) {
    imgSrcDir = settings.imgSrcDir;

    // copy all custom image files
    return gulp
      .src([`${imgSrcDir}interface/public/images/*`])
      .pipe(gulp.dest(`dist_${type}/app/interface/images`));
  }
});

gulp.task('copy-i18n', () => {
  return gulp
    .src(['./interface/i18n/*.*', './interface/project-tap.i18n'], {
      base: './'
    })
    .pipe(gulp.dest(`./dist_${type}/app`));
});

// generate tab-i18n.json
gulp.task('tap-i18n', cb => {
  const i18nPath = path.join('interface', 'public', 'i18n');
  shell.mkdir('-p', i18nPath);

  let i18nConf = fs.readFileSync('./interface/project-tap.i18n');
  i18nConf = JSON.parse(i18nConf);

  const resources = {};
  i18nConf.supported_languages.forEach(lang => {
    let uiTranslations = {};
    try {
      if (fs.existsSync(`./interface/i18n/app.${lang}.i18n.json`)) {
        uiTranslations = require(`../interface/i18n/app.${lang}.i18n.json`);
      }
    } catch (e) {
      // ignore
    }
    let mistTranslations = require(`../interface/i18n/mist.${lang}.i18n.json`);
    resources[lang] = { project: _.extend(uiTranslations, mistTranslations) };

    let out = JSON.stringify(resources[lang]);
    fs.writeFileSync(path.join(i18nPath, `${lang}.json`), out);
  });

  let out = JSON.stringify(resources);
  fs.writeFile(path.join(i18nPath, 'tap-i18n.json'), out, cb);
});

gulp.task('build-dist', cb => {
  const appPackageJson = _.extend({}, require('../package.json'), {
    // eslint-disable-line global-require
    name: applicationName.replace(/\s/, ''),
    productName: applicationName,
    description: applicationName,
    license: 'GPL-3.0',
    homepage: settings.homepage,
    build: {
      appId: settings.appId,
      asar: true,
      directories: {
        buildResources: '../build',
        output: '../dist'
      },
      linux: {
        category: 'WebBrowser',
        icon: `./app/${type}/icons`,
        target: ['zip', 'deb']
      },
      win: {
        target: ['zip']
      },
      mac: {
        category: 'public.app-category.productivity'
      },
      dmg: {
        background: '../build/dmg-background.jpg',
        iconSize: 128,
        contents: [
          {
            x: 441,
            y: 448,
            type: 'link',
            path: '/Applications'
          },
          {
            x: 441,
            y: 142,
            type: 'file'
          }
        ]
      }
    }
  });

  fs.writeFileSync(
    path.join(__dirname, `../dist_${type}`, 'app', 'package.json'),
    JSON.stringify(appPackageJson, null, 2),
    'utf-8'
  );

  const targets = [];
  if (options.mac) targets.push(builder.Platform.MAC);
  if (options.win) targets.push(builder.Platform.WINDOWS);
  if (options.linux) targets.push(builder.Platform.LINUX);

  builder
    .build({
      targets: builder.createTargets(targets, null, 'all'),
      projectDir: path.join(__dirname, `../dist_${type}`, 'app'),
      publish: 'never',
      config: {
        afterPack(params) {
          return Q.try(() => {
            shell.cp(
              [
                path.join(__dirname, '..', 'LICENSE'),
                path.join(__dirname, '..', 'README.md'),
                path.join(__dirname, '..', 'AUTHORS')
              ],
              params.appOutDir
            );
          });
        }
      }
    })
    .catch(err => {
      throw new Error(err);
    })
    .finally(() => {
      cb();
    });
});

gulp.task('release-dist', done => {
  const distPath = path.join(__dirname, `../dist_${type}`, 'dist');
  const releasePath = path.join(__dirname, `../dist_${type}`, 'release');

  shell.rm('-rf', releasePath);
  shell.mkdir('-p', releasePath);

  const appNameHypen = applicationName.replace(/\s/, '-');
  const appNameNoSpace = applicationName.replace(/\s/, '');
  const versionDashed = version.replace(/\./g, '-');

  const cp = (inputPath, outputPath) => {
    shell.cp(
      path.join(distPath, inputPath),
      path.join(releasePath, outputPath)
    );
  };

  _.each(options.activePlatforms, platform => {
    switch (
      platform // eslint-disable-line default-case
    ) {
      case 'win':
        cp(
          `${applicationName}-${version}-ia32-win.zip`,
          `${appNameHypen}-win32-${versionDashed}.zip`
        );
        cp(
          `${applicationName}-${version}-win.zip`,
          `${appNameHypen}-win64-${versionDashed}.zip`
        );
        break;
      case 'mac':
        cp(
          `${applicationName}-${version}.dmg`,
          `${appNameHypen}-macosx-${versionDashed}.dmg`
        );
        break;
      case 'linux':
        // .deb have underscore separators
        cp(
          `${appNameNoSpace}_${version}_i386.deb`,
          `${appNameHypen}-linux32-${versionDashed}.deb`
        );
        cp(
          `${appNameNoSpace}_${version}_amd64.deb`,
          `${appNameHypen}-linux64-${versionDashed}.deb`
        );

        // .zip have dash separators
        cp(
          `${appNameNoSpace}-${version}-ia32.zip`,
          `${appNameHypen}-linux32-${versionDashed}.zip`
        );
        cp(
          `${appNameNoSpace}-${version}.zip`,
          `${appNameHypen}-linux64-${versionDashed}.zip`
        );
        break;
    }
  });

  done();
});

gulp.task('build-nsis', done => {
  if (!options.win) return done();

  const typeString = `-DTYPE=${type}`;
  const appNameString = `-DAPPNAME=${applicationName.replace(/\s/, '-')}`;
  const networkString = `-DNETWORK=${settings.name}`;
  const portString = `-DPORT=${settings.port}`;
  const gethIdString = `-DGETHID=${settings.defaultNodeTypeId}`;
  const gethString = `-DGETH=${settings.defaultNodeType}`;
  const issueUrlString = `-DISSUEURL=${settings.issueUrl}`;
  const downloadUrlString = `-DDOWNLOADURL=${settings.downloadUrl}`;
  const homeUrlString = `-DHOMEURL=${settings.walletHomeUrl}`;
  const versionParts = version.split('.');
  const versionString = `-DVERSIONMAJOR=${versionParts[0]} -DVERSIONMINOR=${
    versionParts[1]
  } -DVERSIONBUILD=${versionParts[2]}`;

  const cmdString = `makensis ${versionString} ${typeString} ${appNameString} ${networkString} ${portString} ${gethIdString} ${gethString} ${issueUrlString} ${downloadUrlString} ${homeUrlString} scripts/windows-installer.nsi`;

  exec(cmdString, done);
});
