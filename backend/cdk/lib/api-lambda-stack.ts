import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * API Lambda Stack
 * 
 * This stack creates a serverless API layer for our contact form:
 * 
 * 1. Lambda Functions - Handle business logic for leads
 * 2. API Gateway REST API - HTTP interface with CORS support
 * 3. Request/Response Models - Validate and transform data
 * 
 * Architecture:
 * Client -> API Gateway (REST) -> Lambda Functions
 * 
 * Endpoints:
 * - GET  /health        - Health check
 * - POST /leads         - Create a new lead
 * - GET  /leads         - List all leads (for admin)
 * - GET  /leads/{id}    - Get a specific lead
 * 
 * Note: In Part 2, we use in-memory storage. Part 3 adds DynamoDB.
 */
export class ApiLambdaStack extends cdk.Stack {
    public readonly api: apigateway.RestApi;
    public readonly leadsHandler: lambda.Function;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ============================================
        // Lambda Functions
        // ============================================

        /**
         * Health Check Lambda
         * Simple function to verify the API is running
         */
        const healthHandler = new lambdaNodejs.NodejsFunction(this, 'HealthHandler', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/handlers/health.ts'),
            handler: 'handler',
            description: 'Health check endpoint',
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,

            // CloudWatch Logs configuration
            logRetention: logs.RetentionDays.ONE_WEEK,

            // Environment variables
            environment: {
                NODE_ENV: 'production',
                LOG_LEVEL: 'INFO',
            },
            bundling: {
                minify: true,
                sourceMap: true,
            },
        });

        /**
         * Leads Handler Lambda
         * Handles all CRUD operations for leads
         * Uses in-memory storage in Part 2 (DynamoDB in Part 3)
         */
        this.leadsHandler = new lambdaNodejs.NodejsFunction(this, 'LeadsHandler', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/handlers/leads.ts'),
            handler: 'handler',
            description: 'Leads CRUD operations',
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,

            logRetention: logs.RetentionDays.ONE_WEEK,

            environment: {
                NODE_ENV: 'production',
                LOG_LEVEL: 'INFO',
                // DynamoDB table name will be added in Part 3
                // TABLE_NAME: 'LeadsTable',
            },
            bundling: {
                minify: true,
                sourceMap: true,
            },
        });

        // ============================================
        // API Gateway REST API
        // ============================================
        this.api = new apigateway.RestApi(this, 'ContactFormApi', {
            restApiName: 'Contact Form API',
            description: 'Serverless API for contact form lead generation',

            // Deploy immediately to a stage
            deployOptions: {
                stageName: 'prod',

                // Enable request/response logging
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: true,

                // Enable metrics
                metricsEnabled: true,

                // Throttling to prevent abuse
                throttlingBurstLimit: 100,
                throttlingRateLimit: 50,
            },

            // CORS Configuration - Critical for browser requests!
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'Authorization',
                    'X-Amz-Date',
                    'X-Api-Key',
                    'X-Amz-Security-Token',
                ],
                allowCredentials: true,
                maxAge: cdk.Duration.hours(1),
            },

            // Binary media types (if needed for file uploads)
            binaryMediaTypes: ['multipart/form-data'],
        });

        // ============================================
        // API Resources and Methods
        // ============================================

        // Health endpoint: GET /health
        const apiResource = this.api.root.addResource('api');
        const healthResource = apiResource.addResource('health');
        healthResource.addMethod('GET', new apigateway.LambdaIntegration(healthHandler, {
            proxy: true, // Use Lambda Proxy Integration
        }));

        // Leads endpoints
        const leadsResource = apiResource.addResource('leads');

        // POST /leads - Create a new lead
        leadsResource.addMethod('POST', new apigateway.LambdaIntegration(this.leadsHandler, {
            proxy: true,
        }));

        // GET /leads - List all leads
        leadsResource.addMethod('GET', new apigateway.LambdaIntegration(this.leadsHandler, {
            proxy: true,
        }));

        // Single lead endpoints: /leads/{id}
        const leadByIdResource = leadsResource.addResource('{id}');

        // GET /leads/{id} - Get specific lead
        leadByIdResource.addMethod('GET', new apigateway.LambdaIntegration(this.leadsHandler, {
            proxy: true,
        }));

        // PUT /leads/{id} - Update a lead
        leadByIdResource.addMethod('PUT', new apigateway.LambdaIntegration(this.leadsHandler, {
            proxy: true,
        }));

        // DELETE /leads/{id} - Delete a lead
        leadByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(this.leadsHandler, {
            proxy: true,
        }));

        // ============================================
        // Stack Outputs
        // ============================================

        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: this.api.url,
            description: 'API Gateway endpoint URL',
            exportName: 'ContactFormApiEndpoint',
        });

        new cdk.CfnOutput(this, 'ApiId', {
            value: this.api.restApiId,
            description: 'API Gateway ID',
            exportName: 'ContactFormApiId',
        });

        new cdk.CfnOutput(this, 'HealthEndpoint', {
            value: `${this.api.url}health`,
            description: 'Health check endpoint',
        });

        new cdk.CfnOutput(this, 'LeadsEndpoint', {
            value: `${this.api.url}leads`,
            description: 'Leads API endpoint',
        });
    }
}