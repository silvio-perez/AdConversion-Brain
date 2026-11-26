data "aws_ssm_parameter" "ubuntu" {
  name = "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
}

resource "aws_instance" "server" {
  ami                    = data.aws_ssm_parameter.ubuntu.value
  instance_type          = var.instance_type
  subnet_id              = aws_subnet.main.id
  vpc_security_group_ids = [aws_security_group.server.id]
  iam_instance_profile   = aws_iam_instance_profile.server.name
  user_data              = file("${path.module}/user-data.sh")

  # IMDSv2 only, one network hop: containers can't reach the instance's AWS
  # credentials. The host hands short-lived credentials to the one job that
  # needs them (ingestion -> Bedrock); see deploy/production/README.
  metadata_options {
    http_endpoint               = "enabled"
    http_tokens                 = "required"
    http_put_response_hop_limit = 1
  }

  root_block_device {
    volume_type = "gp3"
    volume_size = var.root_volume_gb
    encrypted   = true
    kms_key_id  = aws_kms_key.main.arn
  }

  tags = {
    Name   = local.name
    Backup = "daily"
  }

  lifecycle {
    # A newer Ubuntu image must not silently replace the server.
    ignore_changes = [ami, user_data]
  }
}
