const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_para_demo';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('../frontend'));

// Middleware de autenticación
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// ==================== ENDPOINTS DE USUARIOS ====================

// GET /usuarios - Listar todos los usuarios
app.get('/api/usuarios', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [rows] = await pool.execute(
      'SELECT id, nombre, correo, telefono FROM usuarios LIMIT ? OFFSET ?',
      [limit, offset]
    );

    const [totalRows] = await pool.execute('SELECT COUNT(*) as total FROM usuarios');
    const total = totalRows[0].total;
    const totalPaginas = Math.ceil(total / limit);

    res.json({
      usuarios: rows,
      total,
      pagina: page,
      totalPaginas
    });
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// POST /usuarios - Registrar nuevo usuario
app.post('/api/usuarios', async (req, res) => {
  try {
    const { nombre, correo, contrasena, telefono } = req.body;

    if (!nombre || !correo || !contrasena) {
      return res.status(400).json({
        mensaje: 'Nombre, correo y contraseña son obligatorios',
        codigo: 400
      });
    }

    // Verificar si el correo ya existe
    const [existing] = await pool.execute('SELECT id FROM usuarios WHERE correo = ?', [correo]);
    if (existing.length > 0) {
      return res.status(400).json({
        mensaje: 'El correo ya está registrado',
        codigo: 400
      });
    }

    // Hash de la contraseña
    const hashedPassword = await bcrypt.hash(contrasena, 10);

    const [result] = await pool.execute(
      'INSERT INTO usuarios (nombre, correo, contrasena, telefono) VALUES (?, ?, ?, ?)',
      [nombre, correo, hashedPassword, telefono]
    );

    // Obtener el usuario recién creado (sin contraseña)
    const [newUser] = await pool.execute(
      'SELECT id, nombre, correo, telefono FROM usuarios WHERE id = ?',
      [result.insertId]
    );

    res.status(201).json(newUser[0]);
  } catch (error) {
    console.error('Error creando usuario:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// GET /usuarios/{userId} - Obtener perfil de usuario
app.get('/api/usuarios/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [rows] = await pool.execute(
      'SELECT id, nombre, correo, telefono FROM usuarios WHERE id = ?',
      [userId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        mensaje: 'El usuario no existe',
        codigo: 404
      });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error('Error obteniendo usuario:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// PATCH /usuarios/{userId} - Actualizar perfil de usuario
app.patch('/api/usuarios/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { nombre, correo, telefono } = req.body;

    // Verificar que el usuario existe
    const [existing] = await pool.execute('SELECT id FROM usuarios WHERE id = ?', [userId]);
    if (existing.length === 0) {
      return res.status(404).json({
        mensaje: 'El usuario no existe',
        codigo: 404
      });
    }

    // Construir query dinámica
    const updates = [];
    const params = [];

    if (nombre !== undefined) {
      updates.push('nombre = ?');
      params.push(nombre);
    }
    if (correo !== undefined) {
      updates.push('correo = ?');
      params.push(correo);
    }
    if (telefono !== undefined) {
      updates.push('telefono = ?');
      params.push(telefono);
    }

    if (updates.length === 0) {
      return res.status(400).json({
        mensaje: 'No se proporcionaron datos para actualizar',
        codigo: 400
      });
    }

    params.push(userId);

    await pool.execute(
      `UPDATE usuarios SET ${updates.join(', ')} WHERE id = ?`,
      params
    );

    // Obtener usuario actualizado
    const [updatedUser] = await pool.execute(
      'SELECT id, nombre, correo, telefono FROM usuarios WHERE id = ?',
      [userId]
    );

    res.json(updatedUser[0]);
  } catch (error) {
    console.error('Error actualizando usuario:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// DELETE /usuarios/{userId} - Eliminar cuenta de usuario
app.delete('/api/usuarios/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const [result] = await pool.execute('DELETE FROM usuarios WHERE id = ?', [userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({
        mensaje: 'El usuario no existe',
        codigo: 404
      });
    }

    res.json({
      mensaje: 'Cuenta eliminada correctamente'
    });
  } catch (error) {
    console.error('Error eliminando usuario:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// ==================== AUTENTICACIÓN ====================

// POST /auth/login - Autenticación de usuario
app.post('/api/auth/login', async (req, res) => {
  try {
    const { correo, contrasena } = req.body;

    if (!correo || !contrasena) {
      return res.status(400).json({
        mensaje: 'Correo y contraseña son obligatorios',
        codigo: 400
      });
    }

    // Buscar usuario por correo
    const [users] = await pool.execute(
      'SELECT * FROM usuarios WHERE correo = ?',
      [correo]
    );

    if (users.length === 0) {
      return res.status(401).json({
        mensaje: 'Correo o contraseña incorrectos',
        codigo: 401
      });
    }

    const user = users[0];

    // Verificar contraseña
    const match = await bcrypt.compare(contrasena, user.contrasena);
    if (!match) {
      return res.status(401).json({
        mensaje: 'Correo o contraseña incorrectos',
        codigo: 401
      });
    }

    // Generar token JWT
    const token = jwt.sign(
      { userId: user.id, correo: user.correo },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Eliminar contraseña del objeto de respuesta
    const { contrasena: _, ...userWithoutPassword } = user;

    res.json({
      token,
      usuario: userWithoutPassword
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// ==================== ENDPOINTS DE PROFESIONALES ====================

// GET /profesionales - Búsqueda de profesionales
app.get('/api/profesionales', async (req, res) => {
  try {
    const { especialidad, ubicacion, nombre, seguroId, sinSeguro } = req.query;

    let query = `
      SELECT p.*, 
        GROUP_CONCAT(s.id) AS seguros_ids,
        GROUP_CONCAT(s.nombre) AS seguros_nombres
      FROM profesionales p
      LEFT JOIN profesional_seguro ps ON p.id = ps.profesional_id
      LEFT JOIN seguros s ON ps.seguro_id = s.id
    `;

    const conditions = [];
    const params = [];

    if (especialidad) {
      conditions.push('p.especialidad LIKE ?');
      params.push(`%${especialidad}%`);
    }

    if (ubicacion) {
      conditions.push('p.ubicacion LIKE ?');
      params.push(`%${ubicacion}%`);
    }

    if (nombre) {
      conditions.push('p.nombre LIKE ?');
      params.push(`%${nombre}%`);
    }

    if (seguroId) {
      conditions.push('s.id = ?');
      params.push(seguroId);
    }

    if (sinSeguro === 'true') {
      conditions.push('ps.profesional_id IS NULL');
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' GROUP BY p.id';

    const [rows] = await pool.execute(query, params);

    // Formatear la respuesta para incluir array de seguros
    const profesionales = rows.map(row => ({
      id: row.id,
      nombre: row.nombre,
      especialidad: row.especialidad,
      ubicacion: row.ubicacion,
      contacto: row.contacto,
      segurosAceptados: row.seguros_ids ? row.seguros_ids.split(',').map((id, index) => ({
        id: parseInt(id),
        nombre: row.seguros_nombres.split(',')[index]
      })) : []
    }));

    if (profesionales.length === 0) {
      return res.status(404).json({
        mensaje: 'No se encontraron profesionales',
        codigo: 404
      });
    }

    res.json(profesionales);
  } catch (error) {
    console.error('Error obteniendo profesionales:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// GET /profesionales/{profesionalId} - Obtener detalles de un profesional
app.get('/api/profesionales/:profesionalId', async (req, res) => {
  try {
    const { profesionalId } = req.params;

    const [rows] = await pool.execute(`
      SELECT p.*, 
        GROUP_CONCAT(s.id) AS seguros_ids,
        GROUP_CONCAT(s.nombre) AS seguros_nombres
      FROM profesionales p
      LEFT JOIN profesional_seguro ps ON p.id = ps.profesional_id
      LEFT JOIN seguros s ON ps.seguro_id = s.id
      WHERE p.id = ?
      GROUP BY p.id
    `, [profesionalId]);

    if (rows.length === 0) {
      return res.status(404).json({
        mensaje: 'El profesional no existe',
        codigo: 404
      });
    }

    const profesional = rows[0];
    const response = {
      id: profesional.id,
      nombre: profesional.nombre,
      especialidad: profesional.especialidad,
      ubicacion: profesional.ubicacion,
      contacto: profesional.contacto,
      segurosAceptados: profesional.seguros_ids ? profesional.seguros_ids.split(',').map((id, index) => ({
        id: parseInt(id),
        nombre: profesional.seguros_nombres.split(',')[index]
      })) : []
    };

    res.json(response);
  } catch (error) {
    console.error('Error obteniendo profesional:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// ==================== ENDPOINTS DE SEGUROS ====================

// GET /seguros - Listar aseguradoras
app.get('/api/seguros', async (req, res) => {
  try {
    const [rows] = await pool.execute('SELECT * FROM seguros');

    if (rows.length === 0) {
      return res.status(404).json({
        mensaje: 'No hay seguros disponibles',
        codigo: 404
      });
    }

    res.json(rows);
  } catch (error) {
    console.error('Error obteniendo seguros:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// ==================== ENDPOINTS DE CITAS ====================

// GET /citas - Listar todas las citas
app.get('/api/citas', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const [rows] = await pool.execute(`
      SELECT c.*, u.nombre as usuario_nombre, p.nombre as profesional_nombre
      FROM citas c
      INNER JOIN usuarios u ON c.usuario_id = u.id
      INNER JOIN profesionales p ON c.profesional_id = p.id
      ORDER BY c.fecha_hora DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);

    const [totalRows] = await pool.execute('SELECT COUNT(*) as total FROM citas');
    const total = totalRows[0].total;
    const totalPaginas = Math.ceil(total / limit);

    // Formatear las citas
    const citas = rows.map(row => ({
      id: row.id,
      fechaHora: row.fecha_hora,
      motivo: row.motivo,
      usuario: {
        id: row.usuario_id,
        nombre: row.usuario_nombre
      },
      profesional: {
        id: row.profesional_id,
        nombre: row.profesional_nombre
      }
    }));

    res.json({
      citas,
      total,
      pagina: page,
      totalPaginas
    });
  } catch (error) {
    console.error('Error obteniendo citas:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// POST /citas - Agendar una cita médica
app.post('/api/citas', async (req, res) => {
  try {
    const { usuarioId, profesionalId, fechaHora, motivo } = req.body;

    if (!usuarioId || !profesionalId || !fechaHora) {
      return res.status(400).json({
        mensaje: 'usuarioId, profesionalId y fechaHora son obligatorios',
        codigo: 400
      });
    }

    // Verificar que el usuario y profesional existen
    const [usuarios] = await pool.execute('SELECT id FROM usuarios WHERE id = ?', [usuarioId]);
    const [profesionales] = await pool.execute('SELECT id FROM profesionales WHERE id = ?', [profesionalId]);

    if (usuarios.length === 0 || profesionales.length === 0) {
      return res.status(404).json({
        mensaje: 'Usuario o profesional no encontrado',
        codigo: 404
      });
    }

    // Verificar que la fecha no esté en el pasado
    const fechaCita = new Date(fechaHora);
    if (fechaCita < new Date()) {
      return res.status(400).json({
        mensaje: 'La fecha de la cita no puede ser en el pasado',
        codigo: 400
      });
    }

    // Verificar disponibilidad (simplificado)
    const [citasExistentes] = await pool.execute(
      'SELECT id FROM citas WHERE profesional_id = ? AND fecha_hora = ?',
      [profesionalId, fechaHora]
    );

    if (citasExistentes.length > 0) {
      return res.status(409).json({
        mensaje: 'El horario seleccionado no está disponible',
        codigo: 409
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO citas (usuario_id, profesional_id, fecha_hora, motivo) VALUES (?, ?, ?, ?)',
      [usuarioId, profesionalId, fechaHora, motivo]
    );

    // Obtener la cita recién creada con información de usuario y profesional
    const [newCita] = await pool.execute(`
      SELECT c.*, u.nombre as usuario_nombre, p.nombre as profesional_nombre
      FROM citas c
      INNER JOIN usuarios u ON c.usuario_id = u.id
      INNER JOIN profesionales p ON c.profesional_id = p.id
      WHERE c.id = ?
    `, [result.insertId]);

    const cita = {
      id: newCita[0].id,
      fechaHora: newCita[0].fecha_hora,
      motivo: newCita[0].motivo,
      usuario: {
        id: newCita[0].usuario_id,
        nombre: newCita[0].usuario_nombre
      },
      profesional: {
        id: newCita[0].profesional_id,
        nombre: newCita[0].profesional_nombre
      }
    };

    res.status(201).json(cita);
  } catch (error) {
    console.error('Error creando cita:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// GET /citas/{citaId} - Obtener detalles de una cita
app.get('/api/citas/:citaId', async (req, res) => {
  try {
    const { citaId } = req.params;

    const [rows] = await pool.execute(`
      SELECT c.*, u.nombre as usuario_nombre, p.nombre as profesional_nombre
      FROM citas c
      INNER JOIN usuarios u ON c.usuario_id = u.id
      INNER JOIN profesionales p ON c.profesional_id = p.id
      WHERE c.id = ?
    `, [citaId]);

    if (rows.length === 0) {
      return res.status(404).json({
        mensaje: 'La cita especificada no existe',
        codigo: 404
      });
    }

    const cita = rows[0];
    const response = {
      id: cita.id,
      fechaHora: cita.fecha_hora,
      motivo: cita.motivo,
      usuario: {
        id: cita.usuario_id,
        nombre: cita.usuario_nombre
      },
      profesional: {
        id: cita.profesional_id,
        nombre: cita.profesional_nombre
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Error obteniendo cita:', error);
    res.status(500).json({
      mensaje: 'Error interno del servidor',
      codigo: 500
    });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor Directorio de Salud corriendo en http://localhost:${PORT}`);
  console.log(`📊 Endpoints disponibles:`);
  console.log(`   GET  /api/usuarios`);
  console.log(`   POST /api/usuarios`);
  console.log(`   POST /api/auth/login`);
  console.log(`   GET  /api/profesionales`);
  console.log(`   GET  /api/seguros`);
  console.log(`   GET  /api/citas`);
  console.log(`   POST /api/citas`);
});