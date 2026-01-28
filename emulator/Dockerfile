FROM amazoncorretto:8

WORKDIR /app

RUN yum update -y && \
    yum install -y maven mysql wget python3-pip && \
    pip3 install supervisor && \
    yum clean all
