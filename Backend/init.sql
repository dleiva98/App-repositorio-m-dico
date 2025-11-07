CREATE DATABASE IF NOT EXISTS directorio_salud;
USE directorio_salud;

-- Tabla de usuarios
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    correo VARCHAR(100) UNIQUE NOT NULL,
    contrasena VARCHAR(255) NOT NULL,
    telefono VARCHAR(20),
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de seguros
CREATE TABLE IF NOT EXISTS seguros (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL UNIQUE
);

-- Tabla de profesionales de la salud
CREATE TABLE IF NOT EXISTS profesionales (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(100) NOT NULL,
    especialidad VARCHAR(100) NOT NULL,
    ubicacion VARCHAR(100) NOT NULL,
    contacto VARCHAR(100)
);

-- Tabla intermedia para seguros aceptados por profesionales
CREATE TABLE IF NOT EXISTS profesional_seguro (
    profesional_id INT,
    seguro_id INT,
    PRIMARY KEY (profesional_id, seguro_id),
    FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE CASCADE,
    FOREIGN KEY (seguro_id) REFERENCES seguros(id) ON DELETE CASCADE
);

-- Tabla de citas
CREATE TABLE IF NOT EXISTS citas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NOT NULL,
    profesional_id INT NOT NULL,
    fecha_hora DATETIME NOT NULL,
    motivo TEXT,
    fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
    FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE CASCADE
);

-- Insertar datos de ejemplo
INSERT INTO seguros (nombre) VALUES 
('Seguro Popular'),
('IMSS'),
('ISSSTE'),
('Seguro Privado AXA'),
('Seguro Privado GNP');

INSERT INTO profesionales (nombre, especialidad, ubicacion, contacto) VALUES 
('Dr. Juan Pérez', 'Cardiología', 'Ciudad de México', 'juan.perez@hospital.com'),
('Dra. María García', 'Pediatría', 'Guadalajara', 'maria.garcia@clinica.com'),
('Dr. Carlos López', 'Dermatología', 'Monterrey', 'carlos.lopez@dermacentro.com');

-- Asignar seguros a profesionales (ejemplo)
INSERT INTO profesional_seguro (profesional_id, seguro_id) VALUES
(1, 1), (1, 2), (1, 3),  -- Dr. Juan Pérez acepta Seguro Popular, IMSS, ISSSTE
(2, 2), (2, 4),          -- Dra. María García acepta IMSS y AXA
(3, 5);                  -- Dr. Carlos López acepta GNP

INSERT INTO usuarios (nombre, correo, contrasena, telefono) VALUES 
('Ana López', 'ana@example.com', '$2b$10$K8Lx7QbQ3w2V2Q2V2Q2V2u2V2Q2V2Q2V2Q2V2Q2V2Q2V2Q2V2Q2V2', '+525512345678'),
('Roberto Martínez', 'roberto@example.com', '$2b$10$K8Lx7QbQ3w2V2Q2V2Q2V2u2V2Q2V2Q2V2Q2V2Q2V2Q2V2Q2V2Q2V2', '+525598765432');

INSERT INTO citas (usuario_id, profesional_id, fecha_hora, motivo) VALUES
(1, 1, '2025-11-15 10:30:00', 'Consulta de seguimiento'),
(2, 2, '2025-11-16 14:00:00', 'Chequeo general');
