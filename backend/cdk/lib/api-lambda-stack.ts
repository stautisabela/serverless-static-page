import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * DynamoDB Stack
 * 
 * This stack creates a complete data persistence layer:
 * 
 * 1. DynamoDB Table - Stores leads with proper partitioning
 * 2. Global Secondary Index - Query by email efficiently
 * 3. Lambda Functions - CRUD operations with DynamoDB
 * 4. API Gateway - REST API endpoints
 * 
 * Table Design:
 * - Partition Key: leadId (unique identifier)
 * - GSI: email-index (for lookup by email)
 * 
 * Architecture:
 * API Gateway -> Lambda -> DynamoDB
 */
export class ApiLambdaStack extends cdk.Stack {
    public readonly leadsTable: dynamodb.Table;
    public readonly api: apigateway.RestApi;

    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // ============================================
        // DynamoDB Table
        // ============================================
        /**
         * Leads Table Design:
         * 
         * Primary Key: leadId (String)
         * - Ensures unique identification
         * - Allows efficient single-item operations
         * 
         * GSI: email-index
         * - Partition: email
         * - Allows querying leads by email address
         * 
         * On-Demand Capacity:
         * - Scales automatically
         * - Pay per request (cost-effective for variable workloads)
         */
        this.leadsTable = new dynamodb.Table(this, 'LeadsTable', {
            tableName: 'ContactFormLeads',

            // Partition key - unique identifier for each lead
            partitionKey: {
                name: 'leadId',
                type: dynamodb.AttributeType.STRING,
            },

            // On-demand capacity - scales automatically
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,

            // Point-in-time recovery for data protection
            pointInTimeRecovery: true,

            // Encryption at rest
            encryption: dynamodb.TableEncryption.AWS_MANAGED,

            // Removal policy - DESTROY for dev, RETAIN for production
            removalPolicy: cdk.RemovalPolicy.DESTROY,

            // Time to live - auto-delete old leads (optional)
            // timeToLiveAttribute: 'ttl',
        });

        // Global Secondary Index for querying by email
        this.leadsTable.addGlobalSecondaryIndex({
            indexName: 'email-index',
            partitionKey: {
                name: 'email',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'createdAt',
                type: dynamodb.AttributeType.STRING,
            },
            // Project all attributes to support full lead retrieval
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // Additional GSI for querying by status (useful for admin dashboard)
        this.leadsTable.addGlobalSecondaryIndex({
            indexName: 'status-index',
            partitionKey: {
                name: 'status',
                type: dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: 'createdAt',
                type: dynamodb.AttributeType.STRING,
            },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // ============================================
        // Lambda Functions
        // ============================================

        // Leads Handler with DynamoDB access
        const leadsHandler = new lambdaNodejs.NodejsFunction(this, 'LeadsHandler', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/handlers/leads.ts'),
            handler: 'handler',
            description: 'Leads CRUD operations with DynamoDB',
            timeout: cdk.Duration.seconds(30),
            memorySize: 256,
            logRetention: logs.RetentionDays.ONE_WEEK,

            // Environment variables for DynamoDB access
            environment: {
                TABLE_NAME: this.leadsTable.tableName,
                EMAIL_INDEX: 'email-index',
                STATUS_INDEX: 'status-index',
                NODE_ENV: 'production',
            },
            bundling: {
                minify: true,
                sourceMap: true,
            },
        });

        // Grant DynamoDB read/write permissions to Lambda
        this.leadsTable.grantReadWriteData(leadsHandler);

        // Health Handler
        const healthHandler = new lambdaNodejs.NodejsFunction(this, 'HealthHandler', {
            runtime: lambda.Runtime.NODEJS_22_X,
            entry: path.join(__dirname, '../../lambda/handlers/health.ts'),
            handler: 'handler',
            description: 'Health check endpoint',
            timeout: cdk.Duration.seconds(10),
            memorySize: 128,
            logRetention: logs.RetentionDays.ONE_WEEK,
            environment: {
                TABLE_NAME: this.leadsTable.tableName,
            },
            bundling: {
                minify: true,
                sourceMap: true,
            },
        });

        // Grant read-only access for health checks (optional table check)
        this.leadsTable.grantReadData(healthHandler);

        // ============================================
        // API Gateway
        // ============================================
        this.api = new apigateway.RestApi(this, 'ContactFormApi', {
            restApiName: 'Contact Form API',
            description: 'Serverless API with DynamoDB persistence',

            deployOptions: {
                stageName: 'prod',
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                metricsEnabled: true,
                throttlingBurstLimit: 100,
                throttlingRateLimit: 50,
            },

            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: ['Content-Type', 'Authorization'],
                allowCredentials: true,
            },
        });

        // API Routes
        const health = this.api.root.addResource('health');
        health.addMethod('GET', new apigateway.LambdaIntegration(healthHandler, {
            proxy: true,
        }));

        const leads = this.api.root.addResource('leads');
        leads.addMethod('POST', new apigateway.LambdaIntegration(leadsHandler, {
            proxy: true,
        }));
        leads.addMethod('GET', new apigateway.LambdaIntegration(leadsHandler, {
            proxy: true,
        }));

        const leadById = leads.addResource('{id}');
        leadById.addMethod('GET', new apigateway.LambdaIntegration(leadsHandler, {
            proxy: true,
        }));
        leadById.addMethod('PUT', new apigateway.LambdaIntegration(leadsHandler, {
            proxy: true,
        }));
        leadById.addMethod('DELETE', new apigateway.LambdaIntegration(leadsHandler, {
            proxy: true,
        }));

        // ============================================
        // Outputs
        // ============================================
        new cdk.CfnOutput(this, 'TableName', {
            value: this.leadsTable.tableName,
            description: 'DynamoDB Table Name',
            exportName: 'ContactFormTableName',
        });

        new cdk.CfnOutput(this, 'TableArn', {
            value: this.leadsTable.tableArn,
            description: 'DynamoDB Table ARN',
            exportName: 'ContactFormTableArn',
        });

        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: this.api.url,
            description: 'API Gateway endpoint URL',
            exportName: 'ContactFormApiEndpointV3',
        });
    }
}