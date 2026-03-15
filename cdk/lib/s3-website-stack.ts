import * as cdk from "aws-cdk-lib";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as s3deploy from "aws-cdk-lib/aws-s3-deployment";
import { Construct } from "constructs";
import * as path from "path";

export class S3WebsiteStack extends cdk.Stack {
  public readonly websiteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;

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
  }
}