#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { S3WebsiteStack } from "../lib/s3-website-stack";

const app = new cdk.App();

// Create the S3 Website Stack
new S3WebsiteStack(app, "ContactFormWebsiteStack", {
  // Add meaningful tags for resource management
  tags: {
    Project: "ServerlessWebMastery",
    Part: "1-S3StaticHosting",
    Environment: "Development",
  },
  description:
    "Serverless Web Mastery Part 1: S3 Static Website with CloudFront",
});

app.synth();