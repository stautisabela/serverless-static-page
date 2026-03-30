#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { ApiLambdaStack } from '../lib/api-lambda-stack';

/**
 * AWS CDK App Entry Point - Part 2
 * 
 * This stack creates:
 * - Lambda functions for handling API requests
 * - API Gateway REST API with CORS configuration
 * - Lambda integrations for each endpoint
 * 
 * Deployment: cdk deploy
 * Destruction: cdk destroy
 */
const app = new cdk.App();

new ApiLambdaStack(app, 'ContactFormApiStack', {
    tags: {
        Project: 'ServerlessWebMastery',
        Part: '2-ApiLambda',
        Environment: 'Development'
    },
    description: 'Serverless Web Mastery Part 2: API Gateway with Lambda Functions'
});

app.synth();