-- OTLP log-record passthrough columns.
--
-- Matches RFC 0001 schema-conformance bar: LogRecord.flags (W3C trace
-- flags bitfield) and droppedAttributesCount must survive the receiver
-- end-to-end.

ALTER TABLE logs ADD COLUMN flags INTEGER NOT NULL DEFAULT 0;
ALTER TABLE logs ADD COLUMN dropped_attributes_count INTEGER NOT NULL DEFAULT 0;
