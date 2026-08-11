import { App } from 'aws-cdk-lib';
import { buildAuroraApp } from './app.js';

const app = new App({ outdir: 'cdk.out' });
buildAuroraApp(app);
app.synth();
