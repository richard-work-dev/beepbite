.PHONY: build test vet fmt

GO_PKGS := ./cmd/serverless/... ./pkg/...

build:
	go build -tags lambda.norpc ./cmd/serverless/...

test:
	go test $(GO_PKGS)

vet:
	go vet $(GO_PKGS)

fmt:
	gofmt -w $$(find cmd/serverless pkg -name '*.go' -type f)
