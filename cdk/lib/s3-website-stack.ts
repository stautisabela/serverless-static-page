import * as cdk from 'aws-cdk-lib/core';
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from 'constructs';
import * as path from "path";

/**
 * S3 Website Stack
 * 
 * This stack creates a production-ready static website hosting infrastructure:
 * 
 * 1. S3 Bucket - Stores your static website files (HTML, CSS, JS)
 * 2. CloudFront Distribution - Provides HTTPS, caching, and global edge locations
 * 3. Origin Access Control - Secures S3 bucket access through CloudFront only
 * 4. S3 Deployment - Automatically uploads frontend files during deployment
 * 
 * Architecture:
 * User -> CloudFront (HTTPS) -> S3 Bucket (Origin)
 * 
 * Benefits:
 * - HTTPS by default (no additional certificate needed for CloudFront domain)
 * - Global CDN for faster load times
 * - S3 bucket is not publicly accessible (security best practice)
 * - Automatic cache invalidation on deployment
 */

export class S3WebsiteStack extends cdk.Stack {
  // Expose these for use in other stacks or outputs
  public readonly websiteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ============================================
    // S3 Bucket for Static Website Files
    // ============================================
    this.websiteBucket = new s3.Bucket(this, "WebsiteBucket", {
      // Block ALL public access - CloudFront is our only entry point
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,

      // Enable versioning for rollback capability
      versioned: true,

      // Encryption at rest
      encryption: s3.BucketEncryption.S3_MANAGED,

      // Cleanup on stack deletion (use RETAIN for production!)
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,

      // CORS for API calls (we'll use this in Part 2)
      cors: [
        {
          allowedHeaders: ["*"],
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: ["*"],
          maxAge: 3000,
        },
      ],
    });

    // ============================================
    // CloudFront Distribution
    // ============================================
    this.distribution = new cloudfront.Distribution(
      this,
      "WebsiteDistribution",
      {
        defaultBehavior: {
          // Origin Access Control - the modern, secure way
          origin: origins.S3BucketOrigin.withOriginAccessControl(
            this.websiteBucket,
          ),

          // Always redirect HTTP to HTTPS
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,

          // Optimized caching for static content
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,

          // Allow standard methods
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,

          // Enable compression
          compress: true,
        },

        // Default page
        defaultRootObject: "index.html",

        // Handle SPA routing - return index.html for 404s
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(5),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: "/index.html",
            ttl: cdk.Duration.minutes(5),
          },
        ],

        // Use cheaper edge locations (US, Canada, Europe)
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,

        // Enable HTTP/2 and HTTP/3 for better performance
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,

        comment: "Contact Form Static Website - Serverless Web Mastery",
      },
    );

    // ============================================
    // Deploy Frontend Files
    // ============================================
    new s3deploy.BucketDeployment(this, "DeployWebsite", {
      sources: [s3deploy.Source.asset(path.join(__dirname, "../../frontend"))],
      destinationBucket: this.websiteBucket,

      // Invalidate CloudFront cache after deployment
      distribution: this.distribution,
      distributionPaths: ["/*"],
    });

    // ============================================
    // Lambda Functions
    // ============================================

    const lambdaLogGroup = new logs.LogGroup(this, "LambdaLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Health Check Handler
    const healthHandler = new lambdaNodejs.NodejsFunction(
      this,
      "HealthHandler",
      {
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, "../../lambda/handlers/health.ts"),
        handler: "handler",
        description: "Health check endpoint",
        timeout: cdk.Duration.seconds(10),
        memorySize: 128,
        logGroup: lambdaLogGroup,
        // Environment variables
        environment: {
          NODE_ENV: "production",
          LOG_LEVEL: "INFO",
        },
        bundling: {
          minify: true,
          sourceMap: true,
        },
      },
    );

    // Leads Handler
    const leadsHandler = new lambdaNodejs.NodejsFunction(this, "LeadsHandler", {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, "../../lambda/handlers/leads.ts"),
      handler: "handler",
      description: "Leads CRUD operations",
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: lambdaLogGroup,
      environment: {
        NODE_ENV: "production",
        LOG_LEVEL: "INFO",
      },
      bundling: {
        minify: true,
        sourceMap: true,
      },
    });

    // ============================================
    // API Gateway
    // ============================================
    this.api = new apigateway.RestApi(this, "ContactFormApi", {
      restApiName: "Contact Form API",
      description: "Serverless API for contact form",

      deployOptions: {
        stageName: "prod",
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        metricsEnabled: true,
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
      },

      // CORS - Critical for browser requests!
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ["Content-Type", "Authorization"],
        allowCredentials: true,
      },
    });

    // ============================================
    // API Routes
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
    leadsResource.addMethod('POST', new apigateway.LambdaIntegration(leadsHandler, {
        proxy: true,
    }));

    // GET /leads - List all leads
    leadsResource.addMethod('GET', new apigateway.LambdaIntegration(leadsHandler, {
        proxy: true,
    }));

    // Single lead endpoints: /leads/{id}
    const leadByIdResource = leadsResource.addResource('{id}');

    // GET /leads/{id} - Get specific lead
    leadByIdResource.addMethod('GET', new apigateway.LambdaIntegration(leadsHandler, {
        proxy: true,
    }));

    // PUT /leads/{id} - Update a lead
    leadByIdResource.addMethod('PUT', new apigateway.LambdaIntegration(leadsHandler, {
        proxy: true,
    }));

    // DELETE /leads/{id} - Delete a lead
    leadByIdResource.addMethod('DELETE', new apigateway.LambdaIntegration(leadsHandler, {
        proxy: true,
    }));

    // ============================================
    // Outputs
    // ============================================
    new cdk.CfnOutput(this, "WebsiteURL", {
      value: `https://${this.distribution.distributionDomainName}`,
      description: "Website URL (CloudFront HTTPS)",
    });

    new cdk.CfnOutput(this, "DistributionId", {
      value: this.distribution.distributionId,
      description: "CloudFront Distribution ID",
    });

    new cdk.CfnOutput(this, "BucketName", {
      value: this.websiteBucket.bucketName,
      description: "S3 Bucket Name",
    });

     new cdk.CfnOutput(this, "ApiEndpoint", {
      value: this.api.url,
      description: "API Gateway endpoint URL",
    });
  }
}
